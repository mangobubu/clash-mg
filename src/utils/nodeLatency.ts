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

export function findLowestLatencyProxyNode(
  nodes: ProxyNode[],
  selectLatency: LatencySelector = defaultLatencySelector,
) {
  return nodes.reduce<ProxyNode | undefined>((best, node) => {
    const latency = selectLatency(node);
    if (!node.available || latency <= 0) return best;
    if (!best || latency < selectLatency(best)) return node;
    return best;
  }, undefined);
}
