import type { SessionStage } from '@decypher/core';

interface Props {
  stage: SessionStage;
  hasPlan: boolean;
  hasDiff: boolean;
}

const STEPS = [
  { key: 'plan', num: 1, title: 'Plan before change', sub: 'See what will change' },
  { key: 'protect', num: 2, title: 'Protect what matters', sub: 'Set hard boundaries' },
  { key: 'compare', num: 3, title: 'Compare before / after', sub: 'Understand the diff' },
] as const;

/** Top rail showing which of the three Decypher stages the user is on. */
export function StageRail({ stage, hasPlan, hasDiff }: Props) {
  const currentIndex = hasDiff ? 2 : hasPlan ? 1 : 0;

  return (
    <nav className="rail">
      {STEPS.map((step, i) => {
        const isActive = i === currentIndex && stage !== 'idle';
        const isDone = i < currentIndex;
        const cls = `step${isActive ? ' active' : ''}${isDone ? ' done' : ''}`;
        return (
          <div key={step.key} className={cls}>
            <div className="num">{isDone ? '✓' : step.num}</div>
            <div>
              <div className="t">{step.title}</div>
              <div className="s">{step.sub}</div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
