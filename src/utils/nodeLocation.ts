import type { ProxyNode } from "../types";

export type Continent = "亚洲" | "欧洲" | "美洲" | "大洋洲" | "非洲" | "未定位";
export type ContinentFilter = "all" | Continent;

export const continentOptions: Array<{ label: string; value: ContinentFilter }> = [
  { label: "所有洲", value: "all" },
  { label: "亚洲", value: "亚洲" },
  { label: "欧洲", value: "欧洲" },
  { label: "美洲", value: "美洲" },
  { label: "大洋洲", value: "大洋洲" },
  { label: "非洲", value: "非洲" },
  { label: "未定位", value: "未定位" },
];

const continentKeywords: Record<Exclude<Continent, "未定位">, string[]> = {
  亚洲: ["亚洲", "香港", "日本", "新加坡", "台湾", "韩国", "中国", "泰国", "印度", "越南", "马来西亚", "菲律宾", "印尼", "hong kong", "japan", "tokyo", "osaka", "singapore", "taiwan", "korea", "china", "thailand", "india", "vietnam", "malaysia", "philippines", "indonesia"],
  欧洲: ["欧洲", "德国", "英国", "法国", "荷兰", "瑞士", "意大利", "西班牙", "瑞典", "芬兰", "波兰", "俄罗斯", "europe", "germany", "united kingdom", "london", "france", "netherlands", "switzerland", "italy", "spain", "sweden", "finland", "poland", "russia"],
  美洲: ["美洲", "美国", "加拿大", "巴西", "墨西哥", "洛杉矶", "纽约", "圣何塞", "西雅图", "america", "united states", "canada", "brazil", "mexico", "los angeles", "new york", "san jose", "seattle"],
  大洋洲: ["大洋洲", "澳大利亚", "新西兰", "悉尼", "墨尔本", "oceania", "australia", "new zealand", "sydney", "melbourne"],
  非洲: ["非洲", "南非", "埃及", "尼日利亚", "肯尼亚", "africa", "south africa", "egypt", "nigeria", "kenya"],
};

const countryCodeContinents: Record<string, Exclude<Continent, "未定位">> = {
  HK: "亚洲", JP: "亚洲", SG: "亚洲", TW: "亚洲", KR: "亚洲", CN: "亚洲", TH: "亚洲", IN: "亚洲", VN: "亚洲", MY: "亚洲", PH: "亚洲", ID: "亚洲",
  DE: "欧洲", GB: "欧洲", UK: "欧洲", FR: "欧洲", NL: "欧洲", CH: "欧洲", IT: "欧洲", ES: "欧洲", SE: "欧洲", FI: "欧洲", PL: "欧洲", RU: "欧洲",
  US: "美洲", USA: "美洲", CA: "美洲", BR: "美洲", MX: "美洲",
  AU: "大洋洲", NZ: "大洋洲",
  ZA: "非洲", EG: "非洲", NG: "非洲", KE: "非洲",
};

const flagContinents: Record<string, Exclude<Continent, "未定位">> = {
  "🇭🇰": "亚洲", "🇯🇵": "亚洲", "🇸🇬": "亚洲", "🇹🇼": "亚洲", "🇰🇷": "亚洲", "🇨🇳": "亚洲", "🇹🇭": "亚洲", "🇮🇳": "亚洲", "🇻🇳": "亚洲", "🇲🇾": "亚洲", "🇵🇭": "亚洲", "🇮🇩": "亚洲",
  "🇩🇪": "欧洲", "🇬🇧": "欧洲", "🇫🇷": "欧洲", "🇳🇱": "欧洲", "🇨🇭": "欧洲", "🇮🇹": "欧洲", "🇪🇸": "欧洲", "🇸🇪": "欧洲", "🇫🇮": "欧洲", "🇵🇱": "欧洲", "🇷🇺": "欧洲",
  "🇺🇸": "美洲", "🇨🇦": "美洲", "🇧🇷": "美洲", "🇲🇽": "美洲",
  "🇦🇺": "大洋洲", "🇳🇿": "大洋洲",
  "🇿🇦": "非洲", "🇪🇬": "非洲", "🇳🇬": "非洲", "🇰🇪": "非洲",
};

export function getNodeContinent(node: ProxyNode): Continent {
  if (node.flag && flagContinents[node.flag]) return flagContinents[node.flag];

  const countryCode = node.country?.trim().toUpperCase();
  if (countryCode && countryCodeContinents[countryCode]) return countryCodeContinents[countryCode];

  const locationText = `${node.name} ${node.group ?? ""} ${node.country ?? ""}`.toLowerCase();
  const matched = Object.entries(continentKeywords)
    .find(([, keywords]) => keywords.some((keyword) => locationText.includes(keyword)));
  if (matched) return matched[0] as Exclude<Continent, "未定位">;

  const codeMatches = locationText.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  for (const code of codeMatches) {
    if (countryCodeContinents[code]) return countryCodeContinents[code];
  }
  return "未定位";
}
