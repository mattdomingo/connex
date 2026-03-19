import { useState } from "react";
import type { SearchResult } from "@connex/shared";
import { useAuth } from "../hooks/useAuth.js";
import * as api from "../api/client.js";

export function SearchPage() {
  const { person } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [pathInfo, setPathInfo] = useState<{ personId: number; text: string } | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.length < 1) return;
    setError("");
    setPathInfo(null);
    try {
      const data = await api.searchGraph(query);
      setResults(data);
      setSearched(true);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleFindPath = async (targetId: number) => {
    if (!person) return;
    try {
      const result = await api.getShortestPath(person.id, targetId);
      const names = result.path.map((n) => n.locked ? "???" : n.name).join(" -> ");
      setPathInfo({
        personId: targetId,
        text: result.locked
          ? `Path (${result.totalDegrees} degrees, locked): ${names}`
          : `Path (${result.totalDegrees} degrees): ${names}`,
      });
    } catch (err: any) {
      setPathInfo({ personId: targetId, text: "No path found" });
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Search</h1>
        <p className="page-subtitle">Find people and see how they're connected to you</p>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      <form onSubmit={handleSearch} className="mb-4">
        <div className="flex gap-2">
          <input
            className="search-input flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, company, school, or location..."
          />
          <button type="submit" className="btn btn-primary">Search</button>
        </div>
      </form>

      {searched && results.length === 0 && (
        <div className="card text-secondary text-sm">No results found.</div>
      )}

      {results.map((r) => (
        <div key={r.person.id} className="card">
          <div className="flex justify-between items-center">
            <div>
              <span className={`font-medium${r.locked ? " text-muted" : ""}`}>
                {r.locked ? "Locked Person" : r.person.name}
              </span>
              {!r.locked && r.person.company && (
                <span className="text-sm text-secondary"> at {r.person.company}</span>
              )}
            </div>
            <div className="flex gap-2 items-center">
              {r.locked ? (
                <span className="badge badge-locked">Locked</span>
              ) : r.degree !== null ? (
                <span className="badge badge-accepted">
                  {r.degree === 0
                    ? "You"
                    : `${r.degree} degree${r.degree !== 1 ? "s" : ""}`}
                </span>
              ) : (
                <span className="badge badge-other">Not connected</span>
              )}
            </div>
          </div>

          {!r.locked && (
            <div className="text-xs text-muted mt-2">
              {r.connectionContext}
              {r.person.location && ` · ${r.person.location}`}
              {r.person.school && ` · ${r.person.school}`}
            </div>
          )}

          {!r.locked && r.degree !== null && r.degree > 0 && person && (
            <div className="mt-2">
              <button
                className="btn btn-sm"
                onClick={() => handleFindPath(r.person.id)}
              >
                Find Path
              </button>
              {pathInfo?.personId === r.person.id && (
                <div className="text-xs text-secondary mt-2">{pathInfo.text}</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
