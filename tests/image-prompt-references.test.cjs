const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadModule() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'generation',
    'imagePromptReferences.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    require,
    loaded,
    loaded.exports,
    filePath,
    path.dirname(filePath),
  );
  return loaded.exports;
}

const references = [
  { edgeId: 'edge-1', nodeId: 'node-1', order: 1, title: 'first.png', imageUrl: 'first.png', previewUrl: 'first-thumb.png' },
  { edgeId: 'edge-2', nodeId: 'node-2', order: 2, title: 'second.jpg', imageUrl: 'second.jpg', previewUrl: 'second-thumb.jpg' },
];
const document = {
  root: {
    type: 'root',
    version: 1,
    children: [{
      type: 'paragraph',
      version: 1,
      children: [
        { type: 'text', version: 1, text: 'make ' },
        { type: 'image-reference', version: 1, edgeId: 'edge-1' },
        { type: 'text', version: 1, text: ' wear ' },
        { type: 'image-reference', version: 1, edgeId: 'edge-2' },
      ],
    }],
  },
};
const labels = {
  instruction: (images) => `References: ${images}.`,
  requestHeader: 'Request:',
};

test('plain prompts remain unchanged without a structured document', () => {
  const { buildPromptWithImageReferenceDocument } = loadModule();
  assert.equal(buildPromptWithImageReferenceDocument({
    fallbackPrompt: 'plain prompt',
    references,
    labels,
  }), 'plain prompt');
});

test('reference labels use Chinese ordinals without persisting the index', () => {
  const { formatImageReferenceLabel } = loadModule();
  assert.equal(formatImageReferenceLabel(0, 'zh-CN'), '图一');
  assert.equal(formatImageReferenceLabel(11, 'zh-CN'), '图十二');
  assert.equal(formatImageReferenceLabel(1, 'en-US'), 'Image 2');
});

test('reference picker trigger works directly after surrounding text', () => {
  const { findImageReferenceMentionQuery } = loadModule();
  assert.deepEqual(findImageReferenceMentionQuery('让@图'), {
    start: 1,
    length: 2,
    query: '图',
  });
  assert.deepEqual(findImageReferenceMentionQuery('edit@Image'), {
    start: 4,
    length: 6,
    query: 'Image',
  });
});

test('structured image tokens serialize to display text and remote identifiers', () => {
  const { buildPromptWithImageReferenceDocument, serializeImagePromptForDisplay } = loadModule();
  assert.equal(serializeImagePromptForDisplay({
    document,
    references,
    referenceLabel: (index) => `图${index + 1}`,
  }), 'make @图1 wear @图2');
  assert.equal(buildPromptWithImageReferenceDocument({
    document,
    references,
    labels,
  }), 'References: image1、image2.\n\nRequest:\nmake image1 wear image2');
});

test('reference reorder dynamically changes display and remote numbering', () => {
  const { buildPromptWithImageReferenceDocument, serializeImagePromptForDisplay } = loadModule();
  const reordered = [references[1], references[0]];
  assert.equal(serializeImagePromptForDisplay({
    document,
    references: reordered,
    referenceLabel: (index) => `图${index + 1}`,
  }), 'make @图2 wear @图1');
  assert.equal(buildPromptWithImageReferenceDocument({
    document,
    references: reordered,
    labels,
  }), 'References: image1、image2.\n\nRequest:\nmake image2 wear image1');
});

test('agent reference tokens become durable image-reference nodes', () => {
  const { imagePromptDocumentFromReferenceText, serializeImagePromptForDisplay } = loadModule();
  const generated = imagePromptDocumentFromReferenceText('人物佩戴@图一的帽子，并借鉴@图二的眼镜', references);
  assert.ok(generated);
  assert.deepEqual(
    {
      direction: generated.root.direction,
      format: generated.root.format,
      indent: generated.root.indent,
    },
    { direction: null, format: '', indent: 0 },
  );
  assert.deepEqual(
    {
      direction: generated.root.children[0].direction,
      format: generated.root.children[0].format,
      indent: generated.root.children[0].indent,
      textFormat: generated.root.children[0].textFormat,
      textStyle: generated.root.children[0].textStyle,
    },
    { direction: null, format: '', indent: 0, textFormat: 0, textStyle: '' },
  );
  assert.deepEqual(
    {
      detail: generated.root.children[0].children[0].detail,
      format: generated.root.children[0].children[0].format,
      mode: generated.root.children[0].children[0].mode,
      style: generated.root.children[0].children[0].style,
    },
    { detail: 0, format: 0, mode: 'normal', style: '' },
  );
  assert.equal(serializeImagePromptForDisplay({
    document: generated,
    references,
    referenceLabel: (index) => `图${index + 1}`,
  }), '人物佩戴@图1的帽子，并借鉴@图2的眼镜');
  assert.equal(imagePromptDocumentFromReferenceText('没有引用', references), undefined);
});

test('minimal prompt documents are hydrated before Lexical imports them', () => {
  const { normalizeImagePromptDocument } = loadModule();
  const normalized = normalizeImagePromptDocument(document);
  assert.ok(normalized);
  assert.deepEqual(
    {
      direction: normalized.root.direction,
      format: normalized.root.format,
      indent: normalized.root.indent,
    },
    { direction: null, format: '', indent: 0 },
  );
  assert.deepEqual(
    {
      direction: normalized.root.children[0].direction,
      format: normalized.root.children[0].format,
      indent: normalized.root.children[0].indent,
      textFormat: normalized.root.children[0].textFormat,
      textStyle: normalized.root.children[0].textStyle,
    },
    { direction: null, format: '', indent: 0, textFormat: 0, textStyle: '' },
  );
});

test('removed references are omitted without changing stable tokens', () => {
  const { buildPromptWithImageReferenceDocument, serializeImagePromptForDisplay } = loadModule();
  assert.equal(serializeImagePromptForDisplay({
    document,
    references: [references[1]],
    referenceLabel: (index) => `图${index + 1}`,
    missingReferenceLabel: 'invalid',
  }), 'make @invalid wear @图1');
  assert.equal(buildPromptWithImageReferenceDocument({
    document,
    references: [references[1]],
    labels,
  }), 'References: image1.\n\nRequest:\nmake  wear image1');
});
