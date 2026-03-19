import { useEffect, useRef, useCallback, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphData, GraphNode, GraphEdge } from "@connex/shared";

const COLORS: Record<string, string> = {
  friend: "#3fb950",
  coworker: "#58a6ff",
  classmate: "#bc8cff",
  family: "#d29922",
  other: "#8b949e",
};

interface Props {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
  selectedNodeId: number | null;
  pathNodeIds: Set<number> | null;
  pathEdgeIds: Set<number> | null;
}

export function GraphVisualization({
  data,
  onNodeClick,
  selectedNodeId,
  pathNodeIds,
  pathEdgeIds,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);

  // Transform data for force-graph
  const graphInput = useMemo(() => {
    const nodes = data.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      isUser: n.isUser,
      degree: n.degree,
      locked: n.locked,
      isCenter: n.id === data.centerPersonId,
      tieStrength: n.tieStrength,
    }));

    const links = data.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      relationshipType: e.relationshipType,
      status: e.status,
      closenessScore: e.closenessScore,
      tieStrength: e.tieStrength,
      edgeSource: e.edgeSource,
    }));

    return { nodes, links };
  }, [data]);

  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force("charge").strength(-200);
      fgRef.current.d3Force("link").distance(80);
    }
  }, [graphInput]);

  const nodeColor = useCallback(
    (node: any) => {
      if (node.locked) return "rgba(110, 118, 129, 0.3)";
      if (pathNodeIds?.has(node.id)) return "#f0883e";
      if (node.id === selectedNodeId) return "#f0883e";
      if (node.isCenter) return "#f0883e";
      if (node.isUser) return "#58a6ff";
      // Gmail contacts with tie strength get a green tint
      if (node.tieStrength != null && node.tieStrength > 0.5) return "#3fb950";
      if (node.tieStrength != null) return "#8b949e";
      return "#8b949e";
    },
    [selectedNodeId, pathNodeIds]
  );

  const nodeSize = useCallback(
    (node: any) => {
      if (node.isCenter) return 8;
      if (node.locked) return 3;
      if (pathNodeIds?.has(node.id)) return 7;
      if (node.id === selectedNodeId) return 7;
      // Scale by tie strength: 3-7 range
      if (node.tieStrength != null) return 3 + node.tieStrength * 4;
      return 5;
    },
    [selectedNodeId, pathNodeIds]
  );

  const linkColor = useCallback(
    (link: any) => {
      if (pathEdgeIds?.has(link.id)) return "#f0883e";
      if (link.status === "pending") return "rgba(210, 153, 34, 0.4)";
      if (link.edgeSource === "gmail") {
        const strength = link.tieStrength ?? 0.3;
        // Green with opacity based on strength
        const alpha = 0.2 + strength * 0.6;
        return `rgba(63, 185, 80, ${alpha})`;
      }
      return COLORS[link.relationshipType] || "#30363d";
    },
    [pathEdgeIds]
  );

  const linkWidth = useCallback(
    (link: any) => {
      if (pathEdgeIds?.has(link.id)) return 3;
      if (link.tieStrength != null) {
        // Scale width 0.5-4 based on tie strength
        return 0.5 + link.tieStrength * 3.5;
      }
      return 1;
    },
    [pathEdgeIds]
  );

  const linkDashArray = useCallback((link: any) => {
    if (link.status === "pending") return [4, 4];
    if (link.edgeSource === "gmail" && (link.tieStrength ?? 0) < 0.3) return [2, 3];
    return undefined;
  }, []);

  const nodeLabel = useCallback((node: any) => {
    if (node.locked) return "Locked (upgrade to see)";
    const degreeLabel = node.degree > 0 ? ` (${node.degree}${node.degree === 1 ? "st" : node.degree === 2 ? "nd" : "rd"} degree)` : " (you)";
    const strengthLabel = node.tieStrength != null ? ` · Strength: ${Math.round(node.tieStrength * 100)}` : "";
    return `${node.name}${degreeLabel}${strengthLabel}`;
  }, []);

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = nodeSize(node);
      const color = nodeColor(node);
      const fontSize = Math.max(10 / globalScale, 1.5);

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
      ctx.fillStyle = color;
      ctx.fill();

      if (node.id === selectedNodeId || pathNodeIds?.has(node.id) || node.isCenter) {
        ctx.strokeStyle = "#f0883e";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Label
      if (!node.locked && globalScale > 0.7) {
        ctx.font = `${node.isCenter ? "bold " : ""}${fontSize}px -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = node.locked ? "rgba(110,118,129,0.3)" : "#e1e4e8";
        ctx.fillText(node.name, node.x, node.y + size + 2);
      }
    },
    [nodeSize, nodeColor, selectedNodeId, pathNodeIds]
  );

  return (
    <div ref={containerRef} className="graph-container" style={{ height: "100%", position: "relative" }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={graphInput}
        nodeId="id"
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, nodeSize(node) + 4, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkLineDash={linkDashArray}
        onNodeClick={(node: any) => {
          const graphNode = data.nodes.find((n) => n.id === node.id);
          if (graphNode) onNodeClick(graphNode);
        }}
        backgroundColor="#0f1117"
        width={containerRef.current?.clientWidth}
        height={containerRef.current?.clientHeight}
        cooldownTicks={100}
        warmupTicks={50}
      />
      {/* Strength Legend */}
      <div style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        background: "rgba(22, 27, 34, 0.9)",
        border: "1px solid #30363d",
        borderRadius: 6,
        padding: "8px 12px",
        fontSize: 11,
        color: "#8b949e",
      }}>
        <div style={{ fontWeight: 500, marginBottom: 4, color: "#e1e4e8" }}>Edge Strength</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <div style={{ width: 24, height: 4, background: "rgba(63, 185, 80, 0.8)", borderRadius: 2 }} />
          <span>Strong tie</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <div style={{ width: 24, height: 2, background: "rgba(63, 185, 80, 0.4)", borderRadius: 2 }} />
          <span>Moderate tie</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <div style={{ width: 24, height: 1, background: "rgba(63, 185, 80, 0.2)", borderRadius: 2, borderTop: "1px dashed rgba(63,185,80,0.3)" }} />
          <span>Weak tie</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 24, height: 1, background: "#58a6ff", borderRadius: 2 }} />
          <span>Manual connection</span>
        </div>
      </div>
    </div>
  );
}
