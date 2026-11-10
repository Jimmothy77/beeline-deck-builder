import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COLOR_ORDER, type ColorLetter } from "@/lib/card-facts";
import { CARD_TYPES, RARITIES, type CardFilter, type CardType, type ColorMode, type NumOp, type NumTest, type Rarity } from "@/lib/card-filter";

const COLOR_NAMES: Record<ColorLetter, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const OPS: { value: NumOp | "range"; label: string }[] = [
  { value: "=", label: "=" },
  { value: "<", label: "<" },
  { value: ">", label: ">" },
  { value: "<=", label: "≤" },
  { value: ">=", label: "≥" },
  { value: "range", label: "range" },
];
const cap = (text: string) => text[0]!.toUpperCase() + text.slice(1);
const toggle = <T,>(list: readonly T[], item: T): T[] => (list.includes(item) ? list.filter((other) => other !== item) : [...list, item]);

function Chip({ on, label, title, onClick }: { on: boolean; label: string; title?: string; onClick: () => void }) {
  return (
    <Button type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} title={title} className="h-8 px-2.5" onClick={onClick}>
      {label}
    </Button>
  );
}

function Modes<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; title: string }[]; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-border p-0.5">
      {options.map((option) => (
        <Button key={option.value} type="button" size="sm" variant={value === option.value ? "secondary" : "ghost"} aria-pressed={value === option.value} title={option.title} className="h-7 px-2 text-xs" onClick={() => onChange(option.value)}>
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/** "=", "<", ">", "≤", "≥" with one number, or a range with two. Empty numbers turn the test off. */
function NumberTest({ label, test, onChange }: { label: string; test: NumTest | null; onChange: (test: NumTest | null) => void }) {
  const op = test?.op ?? "=";
  const first = test ? (test.op === "range" ? test.min : test.value) : "";
  const second = test?.op === "range" ? test.max : "";
  const read = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) ? null : Number(text));
  const write = (nextOp: NumOp | "range", a: number | null, b: number | null) => {
    if (a === null) return onChange(null);
    if (nextOp === "range") return onChange({ op: "range", min: a, max: b ?? a });
    onChange({ op: nextOp, value: a });
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select aria-label={`${label} comparison`} value={op} onChange={(event) => write(event.target.value as NumOp | "range", read(String(first)), read(String(second)))} className="h-8 rounded-md border border-border bg-background px-1.5 text-sm">
        {OPS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <Input aria-label={op === "range" ? `${label} from` : label} inputMode="numeric" value={String(first)} onChange={(event) => write(op, read(event.target.value), read(String(second)))} className="h-8 w-16" />
      {op === "range" ? (
        <>
          <span className="text-xs text-muted-foreground">to</span>
          <Input aria-label={`${label} to`} inputMode="numeric" value={String(second)} onChange={(event) => write("range", read(String(first)), read(event.target.value))} className="h-8 w-16" />
        </>
      ) : null}
    </div>
  );
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-center">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * The filter controls under the deck search. Each change rewrites the search
 * box's query, so the box and the controls always say the same thing.
 */
export function CardFilterPanel({ filter, onChange, onReset }: { filter: CardFilter; onChange: (filter: CardFilter) => void; onReset: () => void }) {
  const set = (patch: Partial<CardFilter>) => onChange({ ...filter, ...patch });
  return (
    <section aria-label="Card filter" data-card-filter="" className="grid gap-3 rounded-2xl border border-border bg-card/70 p-3 text-sm">
      <Row title="Color">
        {COLOR_ORDER.map((color) => (
          <Chip key={color} on={filter.colors.includes(color)} label={color} title={COLOR_NAMES[color]} onClick={() => set({ colors: COLOR_ORDER.filter((item) => toggle(filter.colors, color).includes(item)) })} />
        ))}
        <Chip on={filter.colorless} label="C" title="Colorless" onClick={() => set({ colorless: !filter.colorless })} />
        <Chip on={filter.multicolor} label="Multi" title="Multicolor: two or more colors" onClick={() => set({ multicolor: !filter.multicolor })} />
        <Modes<ColorMode>
          label="Color match"
          value={filter.colorMode}
          onChange={(colorMode) => set({ colorMode })}
          options={[
            { value: "any", label: "any", title: "At least one of the picked colors" },
            { value: "all", label: "all", title: "Every picked color, more allowed" },
            { value: "exact", label: "exact", title: "Exactly the picked colors" },
          ]}
        />
      </Row>
      <Row title="Type">
        {CARD_TYPES.map((type) => (
          <Chip key={type} on={filter.types.includes(type)} label={cap(type)} onClick={() => set({ types: toggle<CardType>(filter.types, type) })} />
        ))}
        <Modes<"any" | "all">
          label="Type match"
          value={filter.typeMode}
          onChange={(typeMode) => set({ typeMode })}
          options={[
            { value: "any", label: "any", title: "One of the picked types" },
            { value: "all", label: "all", title: "Every picked type" },
          ]}
        />
        <Input aria-label="Type line contains" placeholder="Type line contains" value={filter.typeText.join(" ")} onChange={(event) => set({ typeText: event.target.value.trim() ? [event.target.value] : [] })} className="h-8 w-44" />
      </Row>
      <Row title="Mana value">
        <NumberTest label="Mana value" test={filter.mv} onChange={(mv) => set({ mv })} />
      </Row>
      <Row title="Rarity">
        {RARITIES.map((rarity) => (
          <Chip key={rarity} on={filter.rarities.includes(rarity)} label={cap(rarity)} onClick={() => set({ rarities: toggle<Rarity>(filter.rarities, rarity) })} />
        ))}
      </Row>
      <Row title="Rules text">
        <Input aria-label="Rules text contains" placeholder="Rules text contains" value={filter.oracle.join(" ")} onChange={(event) => set({ oracle: event.target.value.trim() ? [event.target.value] : [] })} className="h-8 w-56" />
      </Row>
      <Row title="Power">
        <NumberTest label="Power" test={filter.power} onChange={(power) => set({ power })} />
      </Row>
      <Row title="Toughness">
        <NumberTest label="Toughness" test={filter.toughness} onChange={(toughness) => set({ toughness })} />
      </Row>
      <Row title="Show only">
        <Chip on={filter.inDeck} label="In deck (count > 0)" onClick={() => set({ inDeck: !filter.inDeck })} />
        <Chip on={filter.dfc} label="Double-faced" onClick={() => set({ dfc: !filter.dfc })} />
        <Chip on={filter.tokenExtra} label="Tokens and extras" onClick={() => set({ tokenExtra: !filter.tokenExtra })} />
        <Chip on={filter.basics} label="Basic lands" onClick={() => set({ basics: !filter.basics })} />
      </Row>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <p className="text-xs text-muted-foreground">
          Or type in the search box, as on Scryfall: <code>t:creature c:g mv&lt;=3</code>, <code>(c:w or c:u)</code>, <code>c=wu</code>, <code>r:mythic</code>, <code>o:"draw a card"</code>, <code>pow&gt;=4</code>, <code>is:dfc</code>, <code>qty&gt;0</code>. Card facts come from Scryfall, saved once with this version.
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={onReset}>
          Reset filter
        </Button>
      </div>
    </section>
  );
}
