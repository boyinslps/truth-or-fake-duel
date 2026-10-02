// 題庫引用的機構來源。正式上課前請把各題改成實際引用的頁面網址。
import type { Source } from '../shared/types';

export const S = {
  NASA: { name: 'NASA', url: 'https://science.nasa.gov/' },
  NASA_MOON: { name: 'NASA', url: 'https://science.nasa.gov/moon/' },
  NOAA_NWS: { name: '美國國家氣象局（NOAA）', url: 'https://www.weather.gov/safety/lightning' },
  NOAA_OCEAN: { name: '美國國家海洋局（NOAA）', url: 'https://oceanservice.noaa.gov/' },
  NOAA_SNOW: { name: '美國國家海洋暨大氣總署（NOAA）', url: 'https://www.noaa.gov/' },
  USGS: { name: '美國地質調查局（USGS）', url: 'https://www.usgs.gov/' },
  USGS_WATER: { name: 'USGS 水科學學校', url: 'https://www.usgs.gov/special-topics/water-science-school' },
  SI_OCEAN: { name: 'Smithsonian Ocean', url: 'https://ocean.si.edu/' },
  SI_ZOO: { name: 'Smithsonian 國家動物園', url: 'https://nationalzoo.si.edu/' },
  BRIT: { name: '大英百科全書 Britannica', url: 'https://www.britannica.com/' },
  NMNS: { name: '國立自然科學博物館', url: 'https://www.nmns.edu.tw/' },
  BCI: { name: 'Bat Conservation International', url: 'https://www.batcon.org/' },
  PBI: { name: 'Polar Bears International', url: 'https://polarbearsinternational.org/' },
  NPS_YELL: { name: '美國國家公園管理局（黃石）', url: 'https://www.nps.gov/yell/' },
  NPS_DENA: { name: '美國國家公園管理局（德納利）', url: 'https://www.nps.gov/dena/' },
  YSNP: { name: '玉山國家公園管理處', url: 'https://www.ysnp.gov.tw/' },
  TFC: { name: '台灣事實查核中心', url: 'https://tfc-taiwan.org.tw/' },
  SCIAM: { name: 'Scientific American', url: 'https://www.scientificamerican.com/' },
  GA: { name: 'Geoscience Australia', url: 'https://www.ga.gov.au/' },
  CWA: { name: '中央氣象署', url: 'https://www.cwa.gov.tw/' },
} satisfies Record<string, Source>;
