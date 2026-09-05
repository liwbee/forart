// ══════════════════════════════════════════════════════════════════════
// 天气：open-meteo（免费、无需 key）。先地理编码城市→经纬度，再取当前+多日预报。
// 结果缓存 15 分钟，避免频繁请求。WMO weather_code 映射成中文+emoji。
// ══════════════════════════════════════════════════════════════════════
const GEO = 'https://geocoding-api.open-meteo.com/v1/search'
const REVERSE_GEO = 'https://nominatim.openstreetmap.org/reverse'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const TTL = 15 * 60 * 1000
const TIMEOUT = 12000

// WMO 天气代码 → 中文描述 + emoji
const WMO: Record<number, [string, string]> = {
  0: ['晴', '☀️'], 1: ['晴间多云', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
  45: ['雾', '🌫️'], 48: ['冻雾', '🌫️'],
  // WMO 51/53/55 表示毛毛雨密度，并非国内习惯的降雨量等级；界面统一用自然的“小雨”。
  51: ['小雨', '🌦️'], 53: ['小雨', '🌦️'], 55: ['小雨', '🌧️'], 56: ['冻雨', '🌧️'], 57: ['冻雨', '🌧️'],
  61: ['小雨', '🌦️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'], 66: ['冻雨', '🌧️'], 67: ['冻雨', '🌧️'],
  71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '🌨️'],
  80: ['阵雨', '🌦️'], 81: ['阵雨', '🌧️'], 82: ['强阵雨', '⛈️'],
  85: ['阵雪', '🌨️'], 86: ['强阵雪', '❄️'],
  95: ['雷阵雨', '⛈️'], 96: ['雷阵雨，局地冰雹', '⛈️'], 99: ['强雷雨，局地冰雹', '⛈️'],
}
const WMO_EN: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Heavy freezing drizzle',
  61: 'Light rain', 63: 'Moderate rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy rain showers', 85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Heavy thunderstorm with hail',
}
function desc(code: number, locale: string): { text: string; icon: string } {
  const m = WMO[code] || ['未知', '🌡️']
  return { text: locale === 'en-US' ? WMO_EN[code] || 'Unknown' : m[0], icon: m[1] }
}

export interface WeatherResult {
  city: string
  country?: string
  current: { temp: number; feels: number; humidity: number; wind: number; code: number; text: string; icon: string }
  daily: { date: string; max: number; min: number; pop: number; code: number; text: string; icon: string }[]
  updatedTs: number
}

const cache = new Map<string, { data: WeatherResult; ts: number }>()

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'DX-OS/0.1 weather', ...headers }, signal: ctrl.signal })
    if (!r.ok) throw new Error(`Weather service returned HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(t) }
}

async function weatherAt(latitude: number, longitude: number, city: string, country: string | undefined, locale: string): Promise<WeatherResult> {
  const q = `${FORECAST}?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`
  const f = await fetchJson(q)
  const cur = f?.current || {}
  const d = f?.daily || {}
  const cd = desc(Number(cur.weather_code), locale)
  return {
    city,
    country,
    current: {
      temp: Math.round(Number(cur.temperature_2m)),
      feels: Math.round(Number(cur.apparent_temperature)),
      humidity: Math.round(Number(cur.relative_humidity_2m)),
      wind: Math.round(Number(cur.wind_speed_10m)),
      code: Number(cur.weather_code), text: cd.text, icon: cd.icon,
    },
    daily: (d.time || []).map((date: string, i: number) => {
      const c = Number(d.weather_code?.[i])
      const dd = desc(c, locale)
      return { date, max: Math.round(Number(d.temperature_2m_max?.[i])), min: Math.round(Number(d.temperature_2m_min?.[i])), pop: Math.round(Number(d.precipitation_probability_max?.[i] || 0)), code: c, text: dd.text, icon: dd.icon }
    }),
    updatedTs: Date.now(),
  }
}

/** 查询城市天气（当前 + 未来数日）。city 为中文/英文城市名。 */
export async function getWeather(city: string, locale = 'zh-CN'): Promise<WeatherResult> {
  const key = city.trim()
  if (!key) throw new Error(locale === 'en-US' ? 'A city is required' : '请输入城市')
  const cacheKey = `${locale}:${key}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.ts < TTL) return hit.data

  const geoLanguage = locale === 'en-US' ? 'en' : 'zh'
  const geo = await fetchJson(`${GEO}?name=${encodeURIComponent(key)}&count=1&language=${geoLanguage}&format=json`)
  const loc = geo?.results?.[0]
  if (!loc) throw new Error(locale === 'en-US' ? `City not found: “${key}”` : `没找到城市「${key}」`)

  const data = await weatherAt(Number(loc.latitude), Number(loc.longitude), loc.name || key, loc.country, locale)
  cache.set(cacheKey, { data, ts: Date.now() })
  return data
}

/** Query weather from the user's browser-provided position and reverse-geocode its city label. */
export async function getWeatherAt(latitude: number, longitude: number, locale = 'zh-CN'): Promise<WeatherResult> {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error(locale === 'en-US' ? 'Invalid location coordinates' : '无效的位置坐标')
  }
  const cacheKey = `${locale}:coords:${latitude.toFixed(2)},${longitude.toFixed(2)}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.ts < TTL) return hit.data

  let city = locale === 'en-US' ? 'Current Location' : '当前位置'
  let country: string | undefined
  try {
    const language = locale === 'en-US' ? 'en' : 'zh-CN,zh,en'
    const reverse = await fetchJson(
      `${REVERSE_GEO}?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&format=jsonv2&zoom=10&addressdetails=1`,
      { 'Accept-Language': language },
    )
    const address = reverse?.address || {}
    city = address.city || address.municipality || address.town || address.county || address.village || city
    country = address.country
  } catch {
    // Forecast data is still useful when the optional place-name service is unavailable.
  }

  const data = await weatherAt(latitude, longitude, city, country, locale)
  cache.set(cacheKey, { data, ts: Date.now() })
  return data
}
