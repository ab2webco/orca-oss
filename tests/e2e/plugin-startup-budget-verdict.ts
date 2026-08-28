// Why the decision lives outside the spec: the assertion it feeds is a
// statistic over noisy launches, and a statistic can only be trusted if it is
// exercised against samples whose true effect is known.

export type StartupBudgetInput = {
  readonly baselineMs: readonly number[]
  readonly populatedMs: readonly number[]
  readonly budgetMs: number
}

export type StartupBudgetVerdict = {
  readonly withinBudget: boolean
  readonly baselineMeanMs: number
  readonly populatedMeanMs: number
  readonly deltaMs: number
  readonly description: string
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

// Why the mean and not the median: with the sample counts this launch loop can
// afford, the median of each side carries more spread than the effect it is
// asked to resolve, so it both misses real regressions and invents fake ones.
export function evaluateStartupBudget(input: StartupBudgetInput): StartupBudgetVerdict {
  const { baselineMs, populatedMs, budgetMs } = input
  if (baselineMs.length === 0 || populatedMs.length === 0) {
    throw new Error('startup budget needs at least one sample on each side')
  }
  const baselineMeanMs = mean(baselineMs)
  const populatedMeanMs = mean(populatedMs)
  const deltaMs = populatedMeanMs - baselineMeanMs
  return {
    withinBudget: deltaMs <= budgetMs,
    baselineMeanMs,
    populatedMeanMs,
    deltaMs,
    description:
      `${populatedMs.length} plugin launches averaged ${populatedMeanMs.toFixed(0)}ms vs ` +
      `${baselineMs.length} baseline at ${baselineMeanMs.toFixed(0)}ms ` +
      `(delta ${deltaMs.toFixed(0)}ms, budget ${budgetMs}ms)`
  }
}
