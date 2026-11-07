# 策略自动调优日志

> 由 scripts/auto-tune.cjs 在复盘任务中自动追加。回测提升不等于未来中奖概率提升。

## 2026-11-07 自动调优：热号优先 STRATEGY_WEIGHTS.hot.statusBonus.hot 2 → 2.2

- 垫底策略：热号优先（hot，连续两窗口滚动均值 < 最优 ×0.85）
- 验证窗（240 期回放）：期级中奖率 26.39% → 30.00%；单注率 6.11% → 6.78%
- 留出窗：期级中奖率 27.78% → 28.06%
- 回放产物：scratch/auto-tune/2026-11-07-hot-STRATEGY-WEIGHTS-hot-statusBonus-hot-up.json（scratch/ 不进仓库提交，由复盘任务归档）
- 回滚：git revert <本提交>

