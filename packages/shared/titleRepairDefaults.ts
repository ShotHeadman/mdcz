export interface TitleRepairRuleItem {
  readonly source: string;
  readonly replacement: string;
}

export const BUILTIN_TITLE_REPAIR_RULES: readonly TitleRepairRuleItem[] = [
  // 1. 优先匹配长词与多字复合词（避免被单字规则截断）
  { source: "近●相姦", replacement: "近親相姦" },
  { source: "●●相姦", replacement: "近親相姦" },
  { source: "母●相姦", replacement: "母子相姦" },
  { source: "父●相姦", replacement: "父娘相姦" },
  { source: "兄●相姦", replacement: "兄妹相姦" },
  { source: "姉●相姦", replacement: "姉弟相姦" },
  { source: "逆レ●プ", replacement: "逆レイプ" },
  { source: "逆レイ●", replacement: "逆レイプ" },
  { source: "レ●プ", replacement: "レイプ" },
  { source: "レイ●", replacement: "レイプ" },
  { source: "肉●器", replacement: "肉便器" },
  { source: "性●隷", replacement: "性奴隷" },
  { source: "中●し", replacement: "中出し" },
  { source: "ア●ル", replacement: "アナル" },
  { source: "潮●き", replacement: "潮吹き" },
  { source: "お●らし", replacement: "おもらし" },

  // 2. 高频官方避讳词（两字词）
  { source: "催●", replacement: "催眠" },
  { source: "洗●", replacement: "洗脳" },
  { source: "媚●", replacement: "媚薬" },
  { source: "麻●", replacement: "麻薬" },
  { source: "昏●", replacement: "昏睡" },
  { source: "痴●", replacement: "痴漢" },
  { source: "盗●", replacement: "盗撮" },
  { source: "監●", replacement: "監禁" },
  { source: "調●", replacement: "調教" },
  { source: "拷●", replacement: "拷問" },
  { source: "鬼●", replacement: "鬼畜" },
  { source: "輪●", replacement: "輪姦" },
  { source: "獣●", replacement: "獣姦" },
  { source: "陵●", replacement: "陵辱" },
  { source: "脅●", replacement: "脅迫" },
  { source: "拉●", replacement: "拉致" },
  { source: "緊●", replacement: "緊縛" },
  { source: "奴●", replacement: "奴隷" },

  // 3. DLsite 常见替换用语（特定替代词还原）
  { source: "合意なし", replacement: "レイプ" },
  { source: "閉じ込め", replacement: "監禁" },
  { source: "超ひどい", replacement: "鬼畜" },
  { source: "秘密さわさわ", replacement: "痴漢" },
  { source: "精神支配", replacement: "洗脳" },
  { source: "責め苦", replacement: "拷問" },
  { source: "虫えっち", replacement: "蟲姦" },
  { source: "すやすやえっち", replacement: "睡眠姦" },
  { source: "異種えっち", replacement: "異種姦" },
  { source: "機械責め", replacement: "機械姦" },
  { source: "動物なかよし", replacement: "獣姦" },
] as const;
