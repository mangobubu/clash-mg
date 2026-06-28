import type { ProxyNode } from "../types";

type LatencySelector = (node: ProxyNode) => number;

const defaultLatencySelector: LatencySelector = (node) => node.latency;

export function compareProxyNodesByLatency(
  left: ProxyNode,
  right: ProxyNode,
  selectLatency: LatencySelector = defaultLatencySelector,
) {
  const leftLatency = selectLatency(left);
  const rightLatency = selectLatency(right);
  const leftRank = left.available && leftLatency > 0 ? 0 : left.available ? 1 : 2;
  const rightRank = right.available && rightLatency > 0 ? 0 : right.available ? 1 : 2;

  if (leftRank !== rightRank) return leftRank - rightRank;
  if (leftRank === 0) return leftLatency - rightLatency;
  return 0;
}
