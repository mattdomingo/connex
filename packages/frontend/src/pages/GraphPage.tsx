import { useState, useEffect, useCallback, useRef } from "react";
import type { GraphData, GraphNode, ShortestPathResult } from "@connex/shared";
import { useAuth } from "../hooks/useAuth.js";
import * as api from "../api/client.js";
import { GraphVisualization } from "../components/GraphVisualization.js";
import { PersonPanel } from "../components/PersonPanel.js";
import { PathDisplay } from "../components/PathDisplay.js";

export function GraphPage() {
  const { person } = useAuth();
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
            Explore your relationship network. 3rd-degree+ connections are locked.
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
        <div className="flex-1">
          {graphData && (
            <GraphVisualization
              data={graphData}
              onNodeClick={handleNodeClick}
              selectedNodeId={selectedNode?.id ?? null}
              pathNodeIds={pathResult ? new Set(pathResult.path.map((n) => n.id)) : null}
              pathEdgeIds={pathResult ? new Set(pathResult.edges.map((e) => e.id)) : null}
            />
          )}
        </div>

        <div style={{ width: 320, overflowY: "auto" }}>
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
                  <span className="legend-dot" style={{ background: "#58a6ff" }} />
                  <span className="text-xs">Registered user</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: "#8b949e" }} />
                  <span className="text-xs">Contact (not registered)</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: "#6e7681", opacity: 0.4 }} />
                  <span className="text-xs">Locked (3rd degree+)</span>
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
