import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphData, GraphNode } from "@connex/shared";
import { useTheme } from "../hooks/useTheme.js";

/**
 * Relationship → RGB base color.
 * Intensity (alpha / lightness mix) is applied on top based on tie strength or
 * closeness score, giving a monotonic weak→strong gradient within each hue.
 */
const REL_RGB: Record<string, [number, number, number]> = {
  friend:    [63, 185, 80],   // green
  coworker:  [88, 166, 255],  // blue
  classmate: [188, 140, 255], // purple
  family:    [210, 153, 34],  // amber
  other:     [139, 148, 158], // grey
};

/**
 * Compute normalized strength ∈ [0,1] from either tieStrength (gmail-derived)
 * or closenessScore (1–10, manual). Prefer tieStrength when present.
 */
function edgeStrength(link: any): number {
  if (link.tieStrength != null) return Math.max(0, Math.min(1, link.tieStrength));
  if (link.closenessScore != null) return (link.closenessScore - 1) / 9;
  return 0.5;
}

/** Render a CSS rgba() with alpha tied to strength. */
function intensityColor(relType: string, strength: number): string {
  const [r, g, b] = REL_RGB[relType] || REL_RGB.other;
  // Alpha range: 0.2 (weak) → 1.0 (strong), monotonic.
  const alpha = 0.2 + strength * 0.8;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function relLabel(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

interface Props {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
  selectedNodeId: number | null;
  pathNodeIds: Set<number> | null;
  pathEdgeIds: Set<number> | null;
}

interface Tooltip {
  x: number;
  y: number;
  relationship: string;
  strength: number;
  sourceName: string;
  targetName: string;
  isGmail: boolean;
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
  const { resolved: theme } = useTheme();

  const [hoveredLink, setHoveredLink] = useState<any>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [dims, setDims] = useState({ w: 600, h: 400 });

  const nodeNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const n of data.nodes) m.set(n.id, n.locked ? "Locked" : n.name);
    return m;
  }, [data.nodes]);

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

  // Responsive sizing via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setDims({ w: r.width, h: r.height });
    });
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force("charge").strength(-200);
      fgRef.current.d3Force("link").distance(80);
    }
  }, [graphInput]);

  const isDark = theme === "dark";
  const bgColor = isDark ? "#0f1117" : "#ffffff";
  const labelColor = isDark ? "#e1e4e8" : "#24292f";
  const lockedColor = isDark ? "rgba(110,118,129,0.3)" : "rgba(110,118,129,0.35)";
  const highlightColor = "#f0883e";

  const nodeColor = useCallback(
    (node: any) => {
      if (node.locked) return lockedColor;
      if (pathNodeIds?.has(node.id)) return highlightColor;
      if (node.id === selectedNodeId) return highlightColor;
      if (node.isCenter) return highlightColor;
      if (node.isUser) return isDark ? "#58a6ff" : "#0969da";
      return isDark ? "#8b949e" : "#6e7781";
    },
    [selectedNodeId, pathNodeIds, isDark, lockedColor]
  );

  const nodeSize = useCallback(
    (node: any) => {
      if (node.isCenter) return 8;
      if (node.locked) return 3;
      if (pathNodeIds?.has(node.id)) return 7;
      if (node.id === selectedNodeId) return 7;
      if (node.tieStrength != null) return 3 + node.tieStrength * 4;
      return 5;
    },
    [selectedNodeId, pathNodeIds]
  );

  const linkColor = useCallback(
    (link: any) => {
      if (pathEdgeIds?.has(link.id)) return highlightColor;
      if (link.status === "pending") return intensityColor("family", 0.3); // dashed amber hint
      const rel = link.relationshipType || "other";
      return intensityColor(rel, edgeStrength(link));
    },
    [pathEdgeIds]
  );

  const linkWidth = useCallback(
    (link: any) => {
      if (pathEdgeIds?.has(link.id)) return 3;
      if (hoveredLink && link.id === hoveredLink.id) return 3;
      return 0.5 + edgeStrength(link) * 3.5;
    },
    [pathEdgeIds, hoveredLink]
  );

  const linkDashArray = useCallback((link: any) => {
    if (link.status === "pending") return [4, 4];
    return undefined;
  }, []);

  const nodeLabel = useCallback((node: any) => {
    if (node.locked) return "Locked (upgrade to see)";
    const suffix = ["th", "st", "nd", "rd"][Math.min(node.degree, 3)] ?? "th";
    const degreeLabel = node.degree > 0 ? ` (${node.degree}${suffix} degree)` : " (you)";
    const strengthLabel = node.tieStrength != null ? ` · Strength: ${Math.round(node.tieStrength * 100)}` : "";
    return `${node.name}${degreeLabel}${strengthLabel}`;
  }, []);

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = nodeSize(node);
      const color = nodeColor(node);
      const fontSize = Math.max(10 / globalScale, 1.5);

      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
      ctx.fillStyle = color;
      ctx.fill();

      if (node.id === selectedNodeId || pathNodeIds?.has(node.id) || node.isCenter) {
        ctx.strokeStyle = highlightColor;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      if (!node.locked && globalScale > 0.7) {
        ctx.font = `${node.isCenter ? "bold " : ""}${fontSize}px -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = labelColor;
        ctx.fillText(node.name, node.x, node.y + size + 2);
      }
    },
    [nodeSize, nodeColor, selectedNodeId, pathNodeIds, labelColor]
  );

  const handleLinkHover = useCallback(
    (link: any) => {
      setHoveredLink(link);
      if (!link || !fgRef.current) {
        setTooltip(null);
        return;
      }
      // Midpoint in graph coords → screen coords
      const sx = typeof link.source === "object" ? link.source.x : undefined;
      const sy = typeof link.source === "object" ? link.source.y : undefined;
      const tx = typeof link.target === "object" ? link.target.x : undefined;
      const ty = typeof link.target === "object" ? link.target.y : undefined;
      if (sx == null || tx == null) return;
      const mx = (sx + tx) / 2;
      const my = (sy! + ty!) / 2;
      const screen = fgRef.current.graph2ScreenCoords(mx, my);

      const srcId = typeof link.source === "object" ? link.source.id : link.source;
      const tgtId = typeof link.target === "object" ? link.target.id : link.target;

      setTooltip({
        x: screen.x,
        y: screen.y,
        relationship: link.relationshipType,
        strength: edgeStrength(link),
        sourceName: nodeNameById.get(srcId) ?? "?",
        targetName: nodeNameById.get(tgtId) ?? "?",
        isGmail: link.edgeSource === "gmail",
      });
    },
    [nodeNameById]
  );

  return (
    <div
      ref={containerRef}
      className="graph-container"
      style={{ height: "100%", width: "100%", position: "relative" }}
    >
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
        nodeLabel={nodeLabel}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkLineDash={linkDashArray}
        linkHoverPrecision={6}
        onLinkHover={handleLinkHover}
        onNodeClick={(node: any) => {
          const graphNode = data.nodes.find((n) => n.id === node.id);
          if (graphNode) onNodeClick(graphNode);
        }}
        backgroundColor={bgColor}
        width={dims.w}
        height={dims.h}
        cooldownTicks={100}
        warmupTicks={50}
      />

      {/* Edge hover tooltip */}
      {tooltip && (
        <div
          className="edge-tooltip"
          style={{
            position: "absolute",
            left: Math.min(Math.max(tooltip.x + 12, 8), dims.w - 180),
            top: Math.min(Math.max(tooltip.y - 10, 8), dims.h - 70),
            pointerEvents: "none",
          }}
        >
          <div className="text-xs font-medium">
            {tooltip.sourceName} ↔ {tooltip.targetName}
          </div>
          <div className="text-xs">
            <span
              className={`badge badge-${tooltip.relationship}`}
              style={{ padding: "0 6px", fontSize: 9 }}
            >
              {relLabel(tooltip.relationship)}
            </span>
            <span style={{ marginLeft: 6 }}>
              Strength {Math.round(tooltip.strength * 100)}
            </span>
            {tooltip.isGmail && (
              <span className="text-muted" style={{ marginLeft: 4 }}>· via email</span>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="graph-legend-box">
        <div style={{ fontWeight: 500, marginBottom: 4 }}>Relationship</div>
        {Object.entries(REL_RGB).map(([rel, rgb]) => (
          <div key={rel} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <div
              style={{
                width: 24,
                height: 3,
                borderRadius: 2,
                background: `linear-gradient(90deg, rgba(${rgb.join(",")},0.2), rgba(${rgb.join(",")},1))`,
              }}
            />
            <span>{relLabel(rel)}</span>
          </div>
        ))}
        <div className="text-muted" style={{ marginTop: 4, fontSize: 10 }}>
          Faded → strong = tie intensity
        </div>
      </div>
    </div>
  );
}
