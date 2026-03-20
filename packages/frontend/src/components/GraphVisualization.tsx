import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphData, GraphNode, GraphEdge } from "@connex/shared";
import { useTheme } from "../hooks/useTheme.js";

const COLORS: Record<string, string> = {
  friend: "#3fb950",
  coworker: "#58a6ff",
  classmate: "#bc8cff",
  family: "#d29922",
  other: "#8b949e",
};

// RGB values for each relationship type (for alpha-blending)
const COLOR_RGB: Record<string, [number, number, number]> = {
  friend: [63, 185, 80],
  coworker: [88, 166, 255],
  classmate: [188, 140, 255],
  family: [210, 153, 34],
  other: [139, 148, 158],
};

function edgeColorWithIntensity(relationshipType: string, tieStrength?: number): string {
  const rgb = COLOR_RGB[relationshipType] || COLOR_RGB.other;
  const strength = tieStrength ?? 0.5;
  // Narrower alpha range — thickness is the primary strength differentiator
  const alpha = 0.35 + strength * 0.55;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(2)})`;
}

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
  const [hoveredLink, setHoveredLink] = useState<{ x: number; y: number; link: any } | null>(null);
  const { resolved: theme } = useTheme();
  const isDark = theme === "dark";
  const graphBg = isDark ? "#0f1117" : "#ffffff";
  const labelColor = isDark ? "#e1e4e8" : "#1f2328";
  const legendBg = isDark ? "rgba(22, 27, 34, 0.9)" : "rgba(255, 255, 255, 0.9)";
  const tooltipBg = isDark ? "rgba(22, 27, 34, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "#30363d" : "#d0d7de";

  const handleLinkHover = useCallback((link: any, prevLink: any) => {
    if (!link) {
      setHoveredLink(null);
      return;
    }
    // Get screen coords from the midpoint of source/target
    const src = link.source;
    const tgt = link.target;
    if (src?.x != null && tgt?.x != null && fgRef.current) {
      const midX = (src.x + tgt.x) / 2;
      const midY = (src.y + tgt.y) / 2;
      const screen = fgRef.current.graph2ScreenCoords(midX, midY);
      setHoveredLink({ x: screen.x, y: screen.y, link });
    }
  }, []);

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
      return edgeColorWithIntensity(link.relationshipType, link.tieStrength);
    },
    [pathEdgeIds]
  );

  const linkWidth = useCallback(
    (link: any) => {
      if (pathEdgeIds?.has(link.id)) return 4;
      if (link.tieStrength != null) {
        // Primary strength differentiator: thickness 0.5-6
        return 0.5 + link.tieStrength * 5.5;
      }
      return 1.5;
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
        ctx.fillStyle = node.locked ? "rgba(110,118,129,0.3)" : labelColor;
        ctx.fillText(node.name, node.x, node.y + size + 2);
      }
    },
    [nodeSize, nodeColor, selectedNodeId, pathNodeIds, labelColor]
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
        onLinkHover={handleLinkHover}
        onNodeClick={(node: any) => {
          const graphNode = data.nodes.find((n) => n.id === node.id);
          if (graphNode) onNodeClick(graphNode);
        }}
        backgroundColor={graphBg}
        width={containerRef.current?.clientWidth}
        height={containerRef.current?.clientHeight}
        cooldownTicks={100}
        warmupTicks={50}
      />
      {/* Edge hover tooltip */}
      {hoveredLink && (
        <div style={{
          position: "absolute",
          left: hoveredLink.x + 10,
          top: hoveredLink.y - 30,
          background: tooltipBg,
          border: `1px solid ${tooltipBorder}`,
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 12,
          color: labelColor,
          pointerEvents: "none",
          zIndex: 20,
          whiteSpace: "nowrap",
        }}>
          <div style={{ fontWeight: 500 }}>
            <span style={{
              display: "inline-block",
              width: 8, height: 8, borderRadius: "50%",
              background: COLORS[hoveredLink.link.relationshipType] || COLORS.other,
              marginRight: 6,
            }} />
            {hoveredLink.link.relationshipType}
          </div>
          <div style={{ color: "#8b949e", marginTop: 2 }}>
            Strength: {hoveredLink.link.tieStrength != null
              ? Math.round(hoveredLink.link.tieStrength * 100)
              : hoveredLink.link.closenessScore * 10}%
          </div>
        </div>
      )}
      {/* Legend */}
      <div style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        background: legendBg,
        border: `1px solid ${tooltipBorder}`,
        borderRadius: 6,
        padding: "8px 12px",
        fontSize: 11,
        color: "var(--text-secondary)",
      }}>
        <div style={{ fontWeight: 500, marginBottom: 4, color: labelColor }}>Edge Colors</div>
        {Object.entries(COLORS).map(([type, color]) => (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <div style={{ width: 24, height: 3, background: color, borderRadius: 2 }} />
            <span>{type}</span>
          </div>
        ))}
        <div style={{ marginTop: 4, fontWeight: 500, marginBottom: 2, color: labelColor }}>Thickness = Strength</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10 }}>Weak</span>
          <svg width={48} height={10}>
            <line x1={0} y1={9} x2={48} y2={2} stroke="rgba(139,148,158,0.7)" strokeWidth={1} strokeLinecap="round" />
            <line x1={0} y1={9} x2={48} y2={2} stroke="rgba(139,148,158,0.4)" strokeWidth={5} strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 10 }}>Strong</span>
        </div>
      </div>
    </div>
  );
}
