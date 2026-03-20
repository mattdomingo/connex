import { useState, useEffect, useCallback, useRef } from "react";
import type { GraphData, GraphNode, ShortestPathResult } from "@connex/shared";
import { useAuth } from "../hooks/useAuth.js";
import { useIntroPath } from "../hooks/useIntroPath.js";
import * as api from "../api/client.js";
import { GraphVisualization } from "../components/GraphVisualization.js";
import { PersonPanel } from "../components/PersonPanel.js";
import { PathDisplay } from "../components/PathDisplay.js";

export function GraphPage() {
  const { person } = useAuth();
  const { allNodeIds: introNodeIds, allEdgePairs: introEdgePairs, hasPath: hasIntroPath, clearIntroPath } = useIntroPath();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [pathResult, setPathResult] = useState<ShortestPathResult | null>(null);
  const [pathTarget, setPathTarget] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadGraph = useCallback(async (center?: number) => {
    try {
      setLoading(true);
      const data = await api.getGraph(center);
      setGraphData(data);
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const handleNodeClick = (node: GraphNode) => {
    if (node.locked) return;
    setSelectedNode(node);
    setPathResult(null);
    setPathTarget(null);
  };

  const handleFindPath = async (targetId: number) => {
    if (!person) return;
    setPathTarget(targetId);
    try {
      const result = await api.getShortestPath(person.id, targetId);
      setPathResult(result);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRecenter = (personId: number) => {
    setSelectedNode(null);
    setPathResult(null);
    setPathTarget(null);
    loadGraph(personId);
  };

  if (loading && !graphData) {
    return <div className="text-secondary">Loading graph...</div>;
  }

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h1 className="page-title">Graph Explorer</h1>
          <p className="page-subtitle">
            Explore your relationship network. Connections beyond your plan's degree limit are locked.
          </p>
        </div>
        {graphData && graphData.centerPersonId !== person?.id && (
          <button className="btn" onClick={() => loadGraph()}>
            Re-center on me
          </button>
        )}
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      <div className="flex gap-4" style={{ height: "calc(100vh - 160px)" }}>
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {graphData && (
            <GraphVisualization
              data={graphData}
              onNodeClick={handleNodeClick}
              selectedNodeId={selectedNode?.id ?? null}
              pathNodeIds={pathResult ? new Set(pathResult.path.map((n) => n.id)) : null}
              pathEdgeIds={pathResult ? new Set(pathResult.edges.map((e) => e.id)) : null}
              introNodeIds={hasIntroPath ? introNodeIds : null}
              introEdgePairs={hasIntroPath ? introEdgePairs : null}
            />
          )}
        </div>

        <div style={{ width: 320, flexShrink: 0, overflowY: "auto" }}>
          {hasIntroPath && !pathResult && (
            <div className="card mb-4" style={{ background: "rgba(240, 136, 62, 0.1)", border: "1px solid rgba(240, 136, 62, 0.3)" }}>
              <div className="flex justify-between items-center">
                <div className="text-sm" style={{ color: "#f0883e", fontWeight: 500 }}>Intro path highlighted</div>
                <button className="btn text-xs" style={{ padding: "2px 8px" }} onClick={clearIntroPath}>Dismiss</button>
              </div>
              <p className="text-xs text-muted mt-1">The introduction chain you built is highlighted on the graph.</p>
            </div>
          )}

          {pathResult && (
            <PathDisplay path={pathResult} onClose={() => { setPathResult(null); setPathTarget(null); }} />
          )}

          {selectedNode && !selectedNode.locked && (
            <PersonPanel
              node={selectedNode}
              isMe={selectedNode.id === person?.id}
              onFindPath={handleFindPath}
              onRecenter={handleRecenter}
            />
          )}

          {!selectedNode && !pathResult && (
            <div className="card">
              <div className="card-header">Getting Started</div>
              <p className="text-sm text-secondary">
                Click on any node in the graph to see details. You can find the shortest
                path between yourself and anyone, or re-center the graph on a different person.
              </p>
              <div className="mt-4">
                <div className="text-xs text-muted mb-2">Graph Legend</div>
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: "var(--accent)" }} />
                  <span className="text-xs">Registered user</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: "var(--text-secondary)" }} />
                  <span className="text-xs">Contact (not registered)</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: "var(--text-muted)", opacity: 0.4 }} />
                  <span className="text-xs">Locked (beyond degree limit)</span>
                </div>
                <div className="legend-item mt-2">
                  <span className="text-xs text-muted">Dashed lines = pending connections</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
