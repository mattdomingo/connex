import type { ShortestPathResult } from "@connex/shared";

interface Props {
  path: ShortestPathResult;
  onClose: () => void;
}

export function PathDisplay({ path, onClose }: Props) {
  return (
    <div className="card mb-4">
      <div className="card-header flex justify-between items-center">
        <span>Shortest Path ({path.totalDegrees} degree{path.totalDegrees !== 1 ? "s" : ""})</span>
        <button className="btn btn-sm" onClick={onClose}>Close</button>
      </div>

      {path.locked && (
        <div className="error-msg text-xs mt-2" style={{ background: "#3d341f", borderColor: "#d29922", color: "#d29922" }}>
          This path passes through locked connections. Upgrade to see full details.
        </div>
      )}

      <div className="path-display mt-2">
        {path.path.map((node, i) => (
          <span key={node.id} className="flex items-center gap-2">
            {i > 0 && <span className="path-arrow">&rarr;</span>}
            <span className={`path-node${node.locked ? " locked" : ""}`}>
              {node.name}
            </span>
          </span>
        ))}
      </div>

      {path.edges.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-muted mb-2">Connections along path:</div>
          {path.edges.map((edge, i) => {
            const from = path.path[i];
            const to = path.path[i + 1];
            return (
              <div key={edge.id} className="text-xs text-secondary mb-2">
                {from.locked ? "???" : from.name} &rarr; {to.locked ? "???" : to.name}
                <span className={`badge badge-${edge.relationshipType} ml-2`} style={{ marginLeft: 6 }}>
                  {edge.relationshipType}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
