import { IconMinus, IconPlus } from './Icons';

export function ServingsStepper({ value, onChange, label = 'Servings' }: { value: number; onChange: (n: number) => void; label?: string }) {
  const clamp = (n: number) => Math.max(1, Math.min(100, Math.round(n)));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="icon-btn" onClick={() => onChange(clamp(value - 1))} disabled={value <= 1} aria-label="Fewer servings">
        <IconMinus size={18} />
      </button>
      <label className="stepper-value">
        <span className="visually-hidden">{label}</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 1) onChange(clamp(n));
          }}
        />
      </label>
      <button type="button" className="icon-btn" onClick={() => onChange(clamp(value + 1))} disabled={value >= 100} aria-label="More servings">
        <IconPlus size={18} />
      </button>
    </div>
  );
}
