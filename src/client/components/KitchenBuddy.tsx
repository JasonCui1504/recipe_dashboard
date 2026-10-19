import { useState } from 'react';
import { api } from '../api';
import { useLoader } from '../state';

/**
 * Sprout, the home-page kitchen companion: a little animated chef who floats,
 * breathes and blinks, with one message per day. The message comes from the
 * local Llama model when AI is on (generated once a day and saved), otherwise
 * from a built-in tip of the day. Animations stop with "reduce motion".
 */
export function KitchenBuddy() {
  const message = useLoader(() => api.dailyMessage(), []);
  const [wiggle, setWiggle] = useState(false);

  const poke = () => {
    if (wiggle) return;
    setWiggle(true);
    window.setTimeout(() => setWiggle(false), 700);
  };

  return (
    <aside className="buddy" aria-label="Sprout’s message for today">
      <div className="buddy-bubble" aria-live="polite">
        {message.loading ? (
          <p className="buddy-thinking" aria-label="Sprout is thinking">
            <span />
            <span />
            <span />
          </p>
        ) : (
          <>
            <p className="buddy-text">{message.data?.text ?? 'Hello! What are we cooking today?'}</p>
            <p className="buddy-source">{message.data?.source === 'llama' ? 'Sprout · today’s note from your Llama' : 'Sprout · tip of the day'}</p>
          </>
        )}
      </div>
      <button type="button" className={`buddy-figure ${wiggle ? 'is-wiggling' : ''}`} onClick={poke} aria-label="Say hi to Sprout">
        <svg viewBox="0 0 160 190" aria-hidden="true" focusable="false">
          <ellipse className="buddy-shadow" cx="80" cy="178" rx="38" ry="7" />
          <g className="buddy-float">
            <g className="buddy-breathe">
              {/* hat */}
              <g className="buddy-hat">
                <circle cx="58" cy="44" r="17" fill="#deeade" />
                <circle cx="80" cy="34" r="21" fill="#deeade" />
                <circle cx="102" cy="44" r="17" fill="#deeade" />
                <rect x="52" y="44" width="56" height="22" rx="6" fill="#deeade" />
                <path d="M80 18c-2-8 4-14 12-13-1 8-6 12-12 13z" fill="#8cc09c" />
                <path d="M80 18c0-5-3-9-8-10" stroke="#8cc09c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                <rect x="52" y="60" width="56" height="7" rx="3" fill="#b0c8b8" />
              </g>
              {/* body */}
              <path d="M80 64c30 0 50 22 50 52 0 30-22 48-50 48s-50-18-50-48c0-30 20-52 50-52z" fill="#4a7c59" />
              <path d="M58 82c8-8 20-11 30-10" stroke="#6fa07e" strokeWidth="5" strokeLinecap="round" fill="none" opacity=".7" />
              {/* face */}
              <g className="buddy-eyes">
                <ellipse cx="65" cy="110" rx="6" ry="7.5" fill="#0d1110" />
                <ellipse cx="95" cy="110" rx="6" ry="7.5" fill="#0d1110" />
                <circle cx="67" cy="107" r="2" fill="#deeade" />
                <circle cx="97" cy="107" r="2" fill="#deeade" />
              </g>
              <ellipse cx="55" cy="124" rx="7" ry="4" fill="#c98a73" opacity=".55" />
              <ellipse cx="105" cy="124" rx="7" ry="4" fill="#c98a73" opacity=".55" />
              <path d="M70 126c5 6 15 6 20 0" stroke="#0d1110" strokeWidth="3.5" strokeLinecap="round" fill="none" />
              {/* spoon arm */}
              <g className="buddy-arm">
                <path d="M126 122c8-2 12-8 14-16" stroke="#4a7c59" strokeWidth="9" strokeLinecap="round" fill="none" />
                <path d="M140 106 146 78" stroke="#b0c8b8" strokeWidth="4" strokeLinecap="round" />
                <ellipse cx="147" cy="72" rx="6" ry="9" fill="#b0c8b8" />
              </g>
              <path d="M34 122c-7 2-11 8-12 15" stroke="#4a7c59" strokeWidth="9" strokeLinecap="round" fill="none" />
            </g>
          </g>
        </svg>
      </button>
    </aside>
  );
}
