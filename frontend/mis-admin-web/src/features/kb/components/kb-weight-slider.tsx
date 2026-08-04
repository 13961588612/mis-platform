/**
 * 向量/关键字权重滑条（WA-04）。
 *
 * <p>用原生 `<input type="range">` 而非引入 `@radix-ui/react-slider`：
 * 全站只此一处用到滑条，为它引一个组件库 + 补一层 shadcn 封装 + 适配主题，
 * 性价比太低（见设计文档 §6.2 / U5）。若日后产品要求双手柄或完整键盘无障碍，
 * 再作为独立技术债替换。
 *
 * <p>双侧百分比标注是刻意设计：单看「0.3」没人知道这是「语义占三成」还是「七成」，
 * 必须把两边各占多少同时摆出来，调参时才不会调反。
 */
interface KbWeightSliderProps {
  /** 当前权重 [0,1]，表示**语义（向量）**侧占比。 */
  value: number;
  /** 值变化回调。 */
  onChange: (next: number) => void;
  /** 是否禁用。 */
  disabled?: boolean;
}

/** 步长 0.05：再细用户分辨不出效果差异，反而增加调参成本。 */
const STEP = 0.05;

/** 把 [0,1] 权重转成百分比整数，避免 0.30000000000000004 这种浮点噪声。 */
function toPercent(v: number): number {
  return Math.round(v * 100);
}

export function KbWeightSlider({ value, onChange, disabled = false }: KbWeightSliderProps) {
  const safe = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.3;
  const semanticPct = toPercent(safe);
  const keywordPct = 100 - semanticPct;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          语义 <span className="font-semibold tabular-nums text-foreground">{semanticPct}%</span>
        </span>
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          vectorSimilarityWeight = {safe.toFixed(2)}
        </span>
        <span className="text-muted-foreground">
          关键字 <span className="font-semibold tabular-nums text-foreground">{keywordPct}%</span>
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={STEP}
        value={safe}
        disabled={disabled}
        aria-label="向量（语义）相似度权重"
        aria-valuetext={`语义 ${semanticPct}%，关键字 ${keywordPct}%`}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className="text-xs text-muted-foreground">
        权重越高越偏语义理解，越低越偏关键字精确匹配；仅「混合检索（关键字 + 语义）」下生效。
      </p>
    </div>
  );
}
