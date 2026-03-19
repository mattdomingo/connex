import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GraphNeighborhood,
  GraphNode,
  PathResult,
  RelationshipType,
  SearchResultItem,
  Person,
} from "@connex/shared";
import { RELATIONSHIP_TYPES } from "@connex/shared";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import { api } from "../api/client";
import { useAuth } from "../api/auth-context";

const REL_COLOR: Record<RelationshipType, string> = {
  friend: "#4ade80",
  coworker: "#4f8cff",
  classmate: "#fbbf24",
  family: "#f472b6",
  other: "#8a93a6",
};

const DEGREE_COLOR = ["#ffffff", "#7aa5ff", "#4f8cff", "#6b5bff", "#5b3bff"];

function degreeColor(d: number, locked: boolean) {
  if (locked) return "#2a2340";
  return DEGREE_COLOR[Math.min(d, DEGREE_COLOR.length - 1)];
}

interface FGNode {
  id: number;
  name: string;
  degree: number;
  locked: boolean;
  isRegistered: boolean;
  company?: string | null;
  school?: string | null;
  location?: string | null;
}
interface FGLink {
  id: number;
  source: number;
  target: number;
  relationshipType: RelationshipType;
  locked: boolean;
  status: string;
}

export default function GraphPage() {
  const { user } = useAuth();
  const [degree, setDegree] = useState(2);
  const [data, setData] = useState<GraphNeighborhood | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<Person | null>(null);
  const [path, setPath] = useState<PathResult | null>(null);

  const [searchQ, setSearchQ] = useState("");
  const [searchType, setSearchType] = useState<RelationshipType | "">("");
  const [searchDegree, setSearchDegree] = useState<number>(2);
  const [results, setResults] = useState<SearchResultItem[]>([]);

  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink>>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  const load = useCallback(async () => {
    if (!user) return;
    const nb = await api.explore(degree);
    setData(nb);
  }, [degree, user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setDims({ w: r.width, h: r.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  async function handleNodeClick(n: FGNode & { x?: number; y?: number }) {
    const gn = data?.nodes.find((x) => x.personId === n.id) ?? null;
    setSelected(gn);
    setPath(null);
    setSelectedDetail(null);
    if (gn && !gn.locked) {
      try {
        setSelectedDetail(await api.getPerson(gn.personId));
      } catch {
        /* ignore */
      }
    }
    if (n.x != null && n.y != null) {
      fgRef.current?.centerAt(n.x, n.y, 400);
      fgRef.current?.zoom(2, 400);
    }
  }

  async function showPath(toPersonId: number) {
    const p = await api.path(toPersonId);
    setPath(p);
    // Highlight by zooming to fit
    fgRef.current?.zoomToFit(400, 80, (n) =>
      p.nodes.some((pn) => pn.personId === (n as FGNode).id),
    );
  }

  async function runSearch() {
    const r = await api.search(
      searchQ,
      searchType || undefined,
      searchDegree,
    );
    setResults(r);
  }

  const pathNodeIds = useMemo(
    () => new Set(path?.nodes.map((n) => n.personId) ?? []),
    [path],
  );
  const pathEdgeIds = useMemo(
    () => new Set(path?.edges.map((e) => e.id) ?? []),
    [path],
  );

  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    return {
      nodes: data.nodes.map<FGNode>((n) => ({
        id: n.personId,
        name: n.name,
        degree: n.degree,
        locked: n.locked,
        isRegistered: n.isRegistered,
        company: n.company,
        school: n.school,
        location: n.location,
      })),
      links: data.edges.map<FGLink>((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        relationshipType: e.relationshipType,
        locked: e.locked,
        status: e.status,
      })),
    };
  }, [data]);

  if (!user) return null;

  return (
    <div className="graph-layout">
      <div className="graph-canvas" ref={canvasRef}>
        <div className="graph-controls">
          <label style={{ margin: 0 }}>Depth</label>
          <select
            value={degree}
            onChange={(e) => setDegree(Number(e.target.value))}
          >
            <option value={1}>1°</option>
            <option value={2}>2°</option>
            <option value={3}>3°</option>
            <option value={4}>4°</option>
          </select>
          <button className="secondary" onClick={() => {
            setPath(null);
            setSelected(null);
            fgRef.current?.zoomToFit(400, 60);
          }}>
            Reset view
          </button>
        </div>

        <div className="legend">
          <div><strong>Edges</strong></div>
          {RELATIONSHIP_TYPES.map((t) => (
            <div key={t} className="legend-item">
              <span className="legend-dot" style={{ background: REL_COLOR[t] }} />
              {t}
            </div>
          ))}
          <div style={{ marginTop: 8 }}><strong>Nodes</strong></div>
          {[0, 1, 2, 3].map((d) => (
            <div key={d} className="legend-item">
              <span className="legend-dot" style={{ background: degreeColor(d, false) }} />
              {d === 0 ? "you" : `${d}°`}
            </div>
          ))}
          <div className="legend-item">
            <span className="legend-dot" style={{ background: degreeColor(0, true), border: "1px solid #6b5bff" }} />
            locked
          </div>
        </div>

        <ForceGraph2D
          ref={fgRef}
          width={dims.w}
          height={dims.h}
          graphData={graphData}
          backgroundColor="transparent"
          nodeRelSize={6}
          nodeLabel={(n) => {
            const fn = n as FGNode;
            return `${fn.name} (${fn.degree}°)${fn.locked ? " — locked" : ""}`;
          }}
          nodeCanvasObject={(node, ctx, scale) => {
            const n = node as FGNode & { x: number; y: number };
            const r = n.degree === 0 ? 9 : 6;
            const highlighted = pathNodeIds.has(n.id);

            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = degreeColor(n.degree, n.locked);
            ctx.fill();
            if (n.locked) {
              ctx.strokeStyle = "#6b5bff";
              ctx.lineWidth = 1.5 / scale;
              ctx.stroke();
            }
            if (highlighted) {
              ctx.strokeStyle = "#ffffff";
              ctx.lineWidth = 2 / scale;
              ctx.stroke();
            }
            if (n.isRegistered && !n.locked) {
              ctx.beginPath();
              ctx.arc(n.x, n.y, 2, 0, 2 * Math.PI);
              ctx.fillStyle = "#0b0e14";
              ctx.fill();
            }

            if (scale > 1.2 && !n.locked) {
              const label = n.name;
              ctx.font = `${11 / scale}px -apple-system, sans-serif`;
              ctx.fillStyle = "#e6e8ee";
              ctx.fillText(label, n.x + r + 3, n.y + 3);
            }
          }}
          linkColor={(l) => {
            const link = l as FGLink;
            if (link.locked) return "#3a2f5a";
            if (pathEdgeIds.has(link.id)) return "#ffffff";
            return REL_COLOR[link.relationshipType];
          }}
          linkWidth={(l) => {
            const link = l as FGLink;
            return pathEdgeIds.has(link.id) ? 3 : link.status === "pending" ? 1 : 1.5;
          }}
          linkLineDash={(l) => ((l as FGLink).status === "pending" ? [4, 4] : null)}
          onNodeClick={(n) => handleNodeClick(n as FGNode)}
          cooldownTicks={80}
          onEngineStop={() => fgRef.current?.zoomToFit(300, 60)}
        />
      </div>

      <div className="graph-side">
        {data && user.tier === "free" && data.lockedCount > 0 && (
          <div className="locked-banner">
            <h4>{data.lockedCount} more {data.lockedCount === 1 ? "person" : "people"} beyond 2°</h4>
            <div className="hint" style={{ color: "rgba(255,255,255,0.85)" }}>
              Upgrade to premium to unlock third-degree exploration and full path details.
            </div>
          </div>
        )}

        <div className="panel node-detail">
          {!selected && <div className="empty">Click a node to inspect it.</div>}
          {selected && (
            <>
              <h3>
                {selected.name}{" "}
                {selected.locked && <span className="badge locked">locked</span>}
                {selected.isRegistered && !selected.locked && (
                  <span className="badge reg">registered</span>
                )}
              </h3>
              <div className="meta">{selected.degree}° from you</div>
              {selected.locked ? (
                <p className="hint" style={{ marginTop: 12 }}>
                  This person is {selected.degree} hops away. Details are hidden
                  on your current plan.
                </p>
              ) : (
                <>
                  {selectedDetail && (
                    <div style={{ marginTop: 12 }}>
                      {selectedDetail.bio && <p>{selectedDetail.bio}</p>}
                      <div>
                        {selectedDetail.company && (
                          <span className="badge">{selectedDetail.company}</span>
                        )}
                        {selectedDetail.school && (
                          <span className="badge">{selectedDetail.school}</span>
                        )}
                        {selectedDetail.location && (
                          <span className="badge">{selectedDetail.location}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {selected.degree > 0 && (
                    <button
                      style={{ marginTop: 12 }}
                      onClick={() => showPath(selected.personId)}
                    >
                      Show shortest path
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {path && (
          <div className="panel">
            <h3>Shortest path</h3>
            {!path.found && <div className="empty">No path found.</div>}
            {path.found && (
              <>
                <div className="meta">
                  {path.length} hop{path.length !== 1 ? "s" : ""}
                  {path.locked && (
                    <span className="badge locked" style={{ marginLeft: 8 }}>
                      partially locked
                    </span>
                  )}
                </div>
                <div className="path-view">
                  {path.nodes.map((n, i) => (
                    <span key={n.personId + "-" + i}>
                      <span className={`path-node ${n.locked ? "locked" : ""}`}>
                        {n.name}
                      </span>
                      {i < path.edges.length && (
                        <span className="path-edge">
                          —{path.edges[i].locked ? "···" : path.edges[i].relationshipType}→
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="panel">
          <h3>Search</h3>
          <div className="field">
            <input
              placeholder="name, company, school…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
            />
          </div>
          <div className="row">
            <div className="field">
              <label>Relationship</label>
              <select
                value={searchType}
                onChange={(e) =>
                  setSearchType(e.target.value as RelationshipType | "")
                }
              >
                <option value="">any</option>
                {RELATIONSHIP_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Max degree</label>
              <select
                value={searchDegree}
                onChange={(e) => setSearchDegree(Number(e.target.value))}
              >
                <option value={1}>1°</option>
                <option value={2}>2°</option>
                <option value={3}>3°</option>
              </select>
            </div>
          </div>
          <button onClick={runSearch}>Search</button>

          <div style={{ marginTop: 12 }}>
            {results.map((r) => (
              <div
                key={r.person.id}
                className="list-item"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  if (r.locked) return;
                  const node = data?.nodes.find(
                    (n) => n.personId === r.person.id,
                  );
                  if (node) {
                    setSelected(node);
                    showPath(r.person.id);
                  }
                }}
              >
                <div className="title">
                  {r.person.name}{" "}
                  <span className="badge">{r.degree}°</span>
                  {r.locked && <span className="badge locked">locked</span>}
                </div>
                <div className="sub">
                  via {r.via.join(" → ")}
                  {r.person.company && ` · ${r.person.company}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
