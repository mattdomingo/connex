import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { GraphNode, ApiPerson } from "@connex/shared";
import * as api from "../api/client.js";

interface Props {
  node: GraphNode;
  isMe: boolean;
  onFindPath: (targetId: number) => void;
  onRecenter: (personId: number) => void;
}

export function PersonPanel({ node, isMe, onFindPath, onRecenter }: Props) {
  const navigate = useNavigate();
  const [person, setPerson] = useState<ApiPerson | null>(null);

  useEffect(() => {
    api.getPerson(node.id).then(setPerson).catch(() => {});
  }, [node.id]);

  return (
    <div className="card">
      <div className="card-header flex justify-between items-center">
        <span>{node.name}</span>
        <div className="flex gap-2">
          {node.isUser && <span className="badge badge-coworker">User</span>}
          {!node.isUser && <span className="badge badge-other">Contact</span>}
          <span className="badge badge-friend">
            {node.degree === 0
              ? "You"
              : `${node.degree}${node.degree === 1 ? "st" : node.degree === 2 ? "nd" : "rd"} deg`}
          </span>
        </div>
      </div>

      {person && (
        <dl className="person-detail mt-2">
          {person.bio && (
            <>
              <dt>Bio</dt>
              <dd>{person.bio}</dd>
            </>
          )}
          {person.company && (
            <>
              <dt>Company</dt>
              <dd>{person.company}</dd>
            </>
          )}
          {person.school && (
            <>
              <dt>School</dt>
              <dd>{person.school}</dd>
            </>
          )}
          {person.location && (
            <>
              <dt>Location</dt>
              <dd>{person.location}</dd>
            </>
          )}
        </dl>
      )}

      <div className="flex gap-2 mt-4">
        {!isMe && (
          <button className="btn btn-primary btn-sm" onClick={() => onFindPath(node.id)}>
            Find Path
          </button>
        )}
        {!isMe && (
          <button className="btn btn-sm" onClick={() => onRecenter(node.id)}>
            Re-center
          </button>
        )}
        {!isMe && node.degree > 1 && (
          <button
            className="btn btn-sm"
            onClick={() => navigate(`/introductions?targetId=${node.id}`)}
          >
            Request Intro
          </button>
        )}
      </div>
    </div>
  );
}
