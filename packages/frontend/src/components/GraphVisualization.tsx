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
    }));

    const links = data.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      relationshipType: e.relationshipType,
      status: e.status,
      closenessScore: e.closenessScore,
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
      return 5;
    },
    [selectedNodeId, pathNodeIds]
  );

  const linkColor = useCallback(
    (link: any) => {
      if (pathEdgeIds?.has(link.id)) return "#f0883e";
      if (link.status === "pending") return "rgba(210, 153, 34, 0.4)";
      return COLORS[link.relationshipType] || "#30363d";
    },
    [pathEdgeIds]
  );

  const linkWidth = useCallback(
    (link: any) => {
      if (pathEdgeIds?.has(link.id)) return 3;
      return 1;
    },
    [pathEdgeIds]
  );

  const linkDashArray = useCallback((link: any) => {
    return link.status === "pending" ? [4, 4] : undefined;
  }, []);

  const nodeLabel = useCallback((node: any) => {
    if (node.locked) return "Locked (upgrade to see)";
    return `${node.name}${node.degree > 0 ? ` (${node.degree}${node.degree === 1 ? "st" : node.degree === 2 ? "nd" : "rd"} degree)` : " (you)"}`;
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
    <div ref={containerRef} className="graph-container" style={{ height: "100%" }}>
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
    </div>
  );
}
