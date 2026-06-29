import { useEffect, useState } from "react";
import {
  buildRuntimeStreamUrl,
  emptyRuntimeMetrics,
  parseMemoryBytes,
  parseTrafficMetrics,
  type RuntimeMetrics,
} from "../utils/runtimeMetrics";

const reconnectDelay = 1500;

interface RuntimeMetricsOptions {
  controllerUrl: string;
  secret: string;
  enabled: boolean;
}

export function useRuntimeMetrics({ controllerUrl, secret, enabled }: RuntimeMetricsOptions): RuntimeMetrics {
  const [metrics, setMetrics] = useState<RuntimeMetrics>(emptyRuntimeMetrics);

  useEffect(() => {
    if (!enabled) {
      setMetrics(emptyRuntimeMetrics);
      return;
    }

    setMetrics(emptyRuntimeMetrics);
    const stopTrafficStream = openRuntimeStream(
      buildRuntimeStreamUrl(controllerUrl, "/traffic", secret),
      (payload) => {
        const traffic = parseTrafficMetrics(payload);
        if (traffic) setMetrics((current) => ({ ...current, ...traffic }));
      },
    );
    const stopMemoryStream = openRuntimeStream(
      buildRuntimeStreamUrl(controllerUrl, "/memory", secret),
      (payload) => {
        const memoryBytes = parseMemoryBytes(payload);
        if (memoryBytes !== undefined) setMetrics((current) => ({ ...current, memoryBytes }));
      },
    );

    return () => {
      stopTrafficStream();
      stopMemoryStream();
    };
  }, [controllerUrl, enabled, secret]);

  return metrics;
}

function openRuntimeStream(url: string, onMessage: (payload: string) => void): () => void {
  let disposed = false;
  let socket: WebSocket | undefined;
  let retryTimer: number | undefined;

  const connect = () => {
    if (disposed) return;

    try {
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        if (typeof event.data === "string") onMessage(event.data);
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        socket = undefined;
        if (!disposed) retryTimer = window.setTimeout(connect, reconnectDelay);
      };
    } catch {
      retryTimer = window.setTimeout(connect, reconnectDelay);
    }
  };

  connect();

  return () => {
    disposed = true;
    window.clearTimeout(retryTimer);
    socket?.close();
  };
}
