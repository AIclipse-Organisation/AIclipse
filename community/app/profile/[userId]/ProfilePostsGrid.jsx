"use client";

import { useEffect, useState } from "react";
import PostBox from "../../components/post/PostBox";

export default function ProfilePostsGrid({ userId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [postsRes, meRes] = await Promise.all([
          fetch(`/community/posts?user_id=${encodeURIComponent(userId)}&limit=50`, {
            credentials: "include",
          }),
          fetch("/auth/me", { credentials: "include" }),
        ]);

        if (meRes.ok) {
          const me = await meRes.json().catch(() => null);
          setCurrentUserId(me?.user_id || null);
        }

        if (!postsRes.ok) {
          setError("Failed to load posts.");
          return;
        }

        const postsData = await postsRes.json();
        setItems(Array.isArray(postsData.items) ? postsData.items : []);
      } catch (err) {
        setError("Failed to load posts.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [userId]);

  if (loading) {
    return <div className="pub-profile-posts-status">Loading posts…</div>;
  }

  if (error) {
    return <div className="pub-profile-posts-status">{error}</div>;
  }

  if (items.length === 0) {
    return <div className="pub-profile-posts-status">No posts yet.</div>;
  }

  return (
    <div className="pub-profile-posts-section">
      <div className="pub-profile-posts-title">Posts</div>
      <div className="comm_grid">
        {items.map((item) => (
          <PostBox key={item.post_id} image={item} currentUserId={currentUserId} />
        ))}
      </div>
    </div>
  );
}
