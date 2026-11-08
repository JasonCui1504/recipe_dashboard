import { useEffect, useRef, useState } from 'react';
import type { Recipe } from '../../shared/schema';
import { api, errorMessage, type HealthRating, type HealthReview } from '../api';
import { Loading, Modal } from './common';
import { IconSpark } from './Icons';

export const RATING_LABEL: Record<HealthRating, string> = {
  great: 'Great',
  good: 'Good',
  okay: 'Okay',
  limit: 'Go easy',
};

type Result = { review: HealthReview } | { error: string };

/**
 * Finished reviews, kept until the page is reloaded so closing the panel or
 * visiting another recipe doesn't throw the answer away. Keyed by the recipe's
 * last edit, so editing a recipe asks again. Nothing is saved to the database.
 */
const finished = new Map<string, Result>();
const running = new Map<string, Promise<Result>>();
const keyOf = (r: Recipe) => `${r.id}@${r.updatedAt}`;

function runReview(recipe: Recipe): Promise<Result> {
  const key = keyOf(recipe);
  let p = running.get(key);
  if (!p) {
    p = api.ai
      .health(recipe.id)
      .then((review): Result => ({ review }))
      .catch((err): Result => ({ error: errorMessage(err) }))
      .then((result) => {
        finished.set(key, result);
        running.delete(key);
        return result;
      });
    running.set(key, p);
  }
  return p;
}

/** A side panel where your local model rates each ingredient and sums up how healthy the recipe is. */
export function HealthReviewPanel({ recipe, open, onClose }: { recipe: Recipe; open: boolean; onClose: () => void }) {
  const key = keyOf(recipe);
  const [result, setResult] = useState<Result | null>(() => finished.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const current = useRef(key);
  current.current = key;

  const start = (fresh: boolean) => {
    if (fresh) finished.delete(key);
    setResult(null);
    setLoading(true);
    void runReview(recipe).then((r) => {
      if (current.current !== key) return; // the recipe changed meanwhile
      setResult(r);
      setLoading(false);
    });
  };

  // Opening the panel starts a review the first time, or shows the last one.
  useEffect(() => {
    if (!open) return;
    const done = finished.get(key);
    if (done) {
      setResult(done);
      setLoading(false);
    } else start(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  const review = result && 'review' in result ? result.review : null;
  const unratedNames = review ? review.unrated.map((i) => recipe.ingredients[i]?.name).filter(Boolean) : [];

  return (
    <Modal open={open} onClose={onClose} title="Health check" side>
      <p className="ai-label">
        <IconSpark size={16} /> An opinion from your local model, not nutrition data or medical advice. It can be wrong, so use your own judgement.
      </p>

      {loading && <Loading label="Your local model is reviewing each ingredient… This can take a minute." />}

      {result && 'error' in result && (
        <div className="state state-error" role="alert">
          <p>{result.error}</p>
          <button type="button" className="btn btn-ghost" onClick={() => start(true)}>
            Try again
          </button>
        </div>
      )}

      {review && (
        <div className="health-review">
          <section aria-labelledby="health-ing-title">
            <h3 id="health-ing-title" className="health-heading">
              Ingredient by ingredient
            </h3>
            <ul className="health-list">
              {review.ingredients.map((item) => (
                <li key={item.index}>
                  <div className="health-row-head">
                    <strong>{item.name}</strong>
                    <span className={`health-chip health-${item.rating}`}>{RATING_LABEL[item.rating]}</span>
                  </div>
                  <p className="muted small">{item.reason}</p>
                </li>
              ))}
            </ul>
            {unratedNames.length > 0 && <p className="muted small">Not rated: {unratedNames.join(', ')}.</p>}
          </section>

          <section className="health-summary" aria-labelledby="health-summary-title">
            <h3 id="health-summary-title" className="health-heading">
              Summary
            </h3>
            <div className="health-score">
              <span className="health-score-num" aria-label={`Score ${review.score} out of 10`}>
                {review.score}
                <span className="muted">/10</span>
              </span>
              <span className="health-verdict">{review.verdict}</span>
            </div>
            <div className="health-meter" aria-hidden="true">
              <span style={{ width: `${review.score * 10}%` }} />
            </div>
            <p className="health-meter-scale muted small" aria-hidden="true">
              <span>Occasional treat</span>
              <span>Nourishing everyday meal</span>
            </p>
            <p>{review.summary}</p>
            {review.tips.length > 0 && (
              <>
                <h4 className="health-subheading">Ways to make it healthier</h4>
                <ul className="health-tips">
                  {review.tips.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={() => start(true)}>
              Review again
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
          <p className="muted small">Nothing in your recipe has been changed.</p>
        </div>
      )}
    </Modal>
  );
}
