import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import type ExcelJS from 'exceljs'
import { dataPath } from './dataPaths.ts'

export interface LingxingMappingField {
  id: string
  label: string
  uniqueValues: string[]
  valueCount: number
}

export interface LingxingMappingSheet {
  name: string
  headerRow: number
  rowCount: number
  mappedRows: number
}

export interface LingxingMappingDataset {
  version: 1
  fileName: string
  storedFileName: string
  fileSize: number
  uploadedAt: number
  asinCount: number
  rowCount: number
  fields: LingxingMappingField[]
  sheets: LingxingMappingSheet[]
  records: Record<string, Record<string, string[]>>
  recordRows: Record<string, Array<Record<string, string>>>
  siteFieldId: string
  siteRecordCount: number
  siteRecords: Record<string, Record<string, Record<string, string[]>>>
}

const MAX_FILE_BYTES = 24 * 1024 * 1024
const MAX_ROWS = 200_000
const HEADER_SCAN_ROWS = 50

function mappingRoot() {
  return dataPath('lingxing-mappings')
}

function mappingDir() {
  return join(mappingRoot(), 'shared')
}

function metadataPath() {
  return join(mappingDir(), 'mapping.json')
}

function validDataset(value: unknown): value is LingxingMappingDataset {
  const dataset = value as LingxingMappingDataset | null
  return !!dataset && dataset.version === 1 && !!dataset.records && Array.isArray(dataset.fields) && typeof dataset.storedFileName === 'string'
}

function migrateLatestUserMapping() {
  if (existsSync(metadataPath()) || !existsSync(mappingRoot())) return
  let latest: { directory: string; dataset: LingxingMappingDataset } | null = null
  for (const entry of readdirSync(mappingRoot(), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'shared') continue
    const directory = join(mappingRoot(), entry.name)
    const legacyMetadata = join(directory, 'mapping.json')
    if (!existsSync(legacyMetadata)) continue
    try {
      const dataset = JSON.parse(readFileSync(legacyMetadata, 'utf8')) as unknown
      if (!validDataset(dataset) || !existsSync(join(directory, dataset.storedFileName))) continue
      if (!latest || dataset.uploadedAt > latest.dataset.uploadedAt) latest = { directory, dataset }
    } catch { /* skip malformed legacy mapping */ }
  }
  if (!latest) return
  mkdirSync(mappingDir(), { recursive: true })
  copyFileSync(join(latest.directory, latest.dataset.storedFileName), join(mappingDir(), latest.dataset.storedFileName))
  const temporaryMetadata = `${metadataPath()}.${process.pid}.migrating.tmp`
  writeFileSync(temporaryMetadata, JSON.stringify(latest.dataset), 'utf8')
  renameSync(temporaryMetadata, metadataPath())
}

function normalizeHeader(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s_\-:：]+/g, '')
}

function isAsinHeader(value: string) {
  return new Set(['asin', 'asin码', 'asinid', '商品asin']).has(normalizeHeader(value))
}

function isSiteHeader(value: string) {
  return new Set(['站点', '站点代码', '国家站点', '销售站点', 'site', 'sitecode', 'marketplace', 'marketplacecode', 'countrycode']).has(normalizeHeader(value))
}

function isPrincipalHeader(value: string) {
  return new Set(['负责人', 'principal', 'owner']).has(normalizeHeader(value))
}

function splitMultiValues(value: string) {
  return value.split(/[,，、;；]+/).map((item) => item.trim()).filter(Boolean)
}

function normalizeAsin(value: string) {
  return value.trim().toUpperCase()
}

function decodeFileName(value: string) {
  if ([...value].some((character) => character.charCodeAt(0) > 255)) return value
  const decoded = Buffer.from(value, 'latin1').toString('utf8')
  return decoded.includes('\uFFFD') ? value : decoded
}

function fieldId(label: string) {
  return `field_${createHash('sha1').update(normalizeHeader(label)).digest('hex').slice(0, 12)}`
}

function enrichSiteRecords(dataset: Omit<LingxingMappingDataset, 'siteFieldId' | 'siteRecordCount' | 'siteRecords'> & Partial<Pick<LingxingMappingDataset, 'siteFieldId' | 'siteRecordCount' | 'siteRecords'>>) {
  const principalFieldIds = new Set(dataset.fields.filter((field) => isPrincipalHeader(field.label)).map((field) => field.id))
  const fields = dataset.fields.map((field) => {
    if (!principalFieldIds.has(field.id)) return field
    const uniqueValues = [...new Set(field.uniqueValues.flatMap(splitMultiValues))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    return { ...field, uniqueValues, valueCount: uniqueValues.length }
  })
  const siteFieldId = dataset.siteFieldId || fields.find((field) => isSiteHeader(field.label))?.id || ''
  const siteRecords: LingxingMappingDataset['siteRecords'] = {}
  if (siteFieldId) {
    for (const [asin, rows] of Object.entries(dataset.recordRows || {})) {
      for (const row of rows) {
        const site = String(row[siteFieldId] || '').trim().toUpperCase()
        if (!site) continue
        if (!siteRecords[asin]) siteRecords[asin] = {}
        const record = siteRecords[asin][site] || (siteRecords[asin][site] = {})
        for (const [id, value] of Object.entries(row)) {
          if (!value) continue
          const values = record[id] || (record[id] = [])
          for (const item of principalFieldIds.has(id) ? splitMultiValues(value) : [value]) if (!values.includes(item)) values.push(item)
        }
      }
    }
  }
  return { ...dataset, fields, siteFieldId, siteRecords, siteRecordCount: Object.values(siteRecords).reduce((count, sites) => count + Object.keys(sites).length, 0) } as LingxingMappingDataset
}

function cellText(cell: ExcelJS.Cell) {
  return String(cell.text || '').trim()
}

async function readWorkbook(buffer: Buffer, extension: string) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  if (extension === '.csv') await workbook.csv.read(Readable.from(buffer.toString('utf8')))
  else await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  return workbook
}

export async function importLingxingMapping(file: Express.Multer.File) {
  if (!file?.buffer?.length) throw new Error('请选择需要上传的映射表格')
  if (file.buffer.length > MAX_FILE_BYTES) throw new Error('映射表格不能超过 24 MB')
  const fileName = decodeFileName(file.originalname || 'mapping.xlsx')
  const extension = extname(fileName).toLocaleLowerCase()
  if (!['.xlsx', '.csv'].includes(extension)) throw new Error('目前支持 XLSX 和 CSV 格式')

  const workbook = await readWorkbook(file.buffer, extension)
  const records: Record<string, Record<string, string[]>> = {}
  const recordRows: Record<string, Array<Record<string, string>>> = {}
  const fieldLabels = new Map<string, string>()
  const fieldValues = new Map<string, Set<string>>()
  const sheets: LingxingMappingSheet[] = []
  let rowCount = 0

  for (const worksheet of workbook.worksheets) {
    let headerRowNumber = 0
    let asinColumn = 0
    const scanEnd = Math.min(worksheet.rowCount, HEADER_SCAN_ROWS)
    for (let rowNumber = 1; rowNumber <= scanEnd; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber)
      for (let column = 1; column <= Math.max(row.cellCount, worksheet.columnCount); column += 1) {
        if (isAsinHeader(cellText(row.getCell(column)))) {
          headerRowNumber = rowNumber
          asinColumn = column
          break
        }
      }
      if (asinColumn) break
    }
    if (!asinColumn) continue

    const headerRow = worksheet.getRow(headerRowNumber)
    const columns: Array<{ column: number; id: string; label: string }> = []
    for (let column = 1; column <= Math.max(headerRow.cellCount, worksheet.columnCount); column += 1) {
      const label = cellText(headerRow.getCell(column))
      if (!label || column === asinColumn) continue
      const normalized = normalizeHeader(label)
      if (!normalized) continue
      const existingLabel = fieldLabels.get(normalized)
      const finalLabel = existingLabel || label
      const id = fieldId(finalLabel)
      fieldLabels.set(normalized, finalLabel)
      if (!fieldValues.has(id)) fieldValues.set(id, new Set())
      columns.push({ column, id, label: finalLabel })
    }

    let mappedRows = 0
    for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      if (rowCount >= MAX_ROWS) throw new Error(`映射表格数据不能超过 ${MAX_ROWS.toLocaleString()} 行`)
      const row = worksheet.getRow(rowNumber)
      const asin = normalizeAsin(cellText(row.getCell(asinColumn)))
      if (!asin) continue
      const record = records[asin] || (records[asin] = {})
      const sourceRow: Record<string, string> = {}
      for (const column of columns) {
        const value = cellText(row.getCell(column.column))
        if (!value) continue
        sourceRow[column.id] = value
        const values = record[column.id] || (record[column.id] = [])
        if (!values.includes(value)) values.push(value)
        fieldValues.get(column.id)?.add(value)
      }
      const asinRows = recordRows[asin] || (recordRows[asin] = [])
      asinRows.push(sourceRow)
      mappedRows += 1
      rowCount += 1
    }
    sheets.push({ name: worksheet.name, headerRow: headerRowNumber, rowCount: worksheet.rowCount, mappedRows })
  }

  if (!sheets.length) throw new Error('没有找到 ASIN 表头；请确认至少一个工作表包含名为 ASIN 的列')
  if (!rowCount) throw new Error('找到了 ASIN 表头，但没有读取到有效的 ASIN 数据')

  const labelById = new Map([...fieldLabels.values()].map((label) => [fieldId(label), label]))
  const fields = [...fieldValues.entries()].map(([id, values]) => ({
    id,
    label: labelById.get(id) || id,
    uniqueValues: [...values].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })),
    valueCount: values.size,
  }))

  const directory = mappingDir()
  mkdirSync(directory, { recursive: true })
  const digest = createHash('sha256').update(file.buffer).digest('hex').slice(0, 16)
  const storedFileName = `mapping-source-${digest}${extension}`
  const storedPath = join(directory, storedFileName)
  if (!existsSync(storedPath)) writeFileSync(storedPath, file.buffer)
  const dataset = enrichSiteRecords({
    version: 1,
    fileName,
    storedFileName,
    fileSize: file.buffer.length,
    uploadedAt: Date.now(),
    asinCount: Object.keys(records).length,
    rowCount,
    fields,
    sheets,
    records,
    recordRows,
  })
  const targetMetadata = metadataPath()
  const temporaryMetadata = `${targetMetadata}.${process.pid}.tmp`
  writeFileSync(temporaryMetadata, JSON.stringify(dataset), 'utf8')
  renameSync(temporaryMetadata, targetMetadata)
  for (const entry of readdirSync(directory)) {
    if (entry.startsWith('mapping-source-') && entry !== storedFileName) rmSync(join(directory, entry), { force: true })
  }
  return dataset
}

export function getLingxingMapping(): LingxingMappingDataset | null {
  migrateLatestUserMapping()
  const path = metadataPath()
  if (!existsSync(path)) return null
  try {
    const dataset = JSON.parse(readFileSync(path, 'utf8')) as LingxingMappingDataset
    if (!validDataset(dataset)) return null
    return enrichSiteRecords(dataset)
  } catch {
    return null
  }
}

export function getLingxingMappingFile() {
  const dataset = getLingxingMapping()
  if (!dataset) throw new Error('尚未上传映射表格')
  const path = join(mappingDir(), dataset.storedFileName)
  if (!existsSync(path)) throw new Error('最新映射源文件不存在，请重新上传')
  return {
    path,
    fileName: dataset.fileName,
    contentType: dataset.fileName.toLocaleLowerCase().endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
}
