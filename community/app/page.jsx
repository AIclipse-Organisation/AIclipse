"use client";

import { useEffect, useState } from "react";
import PostBox from "./components/post/PostBox";
import LoadingGrid from "./components/common/LoadingGrid";

export default function Page() {
  const [items, setItems] = useState([]); 

  // session info (needed for voting/commenting inside PostBox)
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserName, setCurrentUserName] = useState(null);

  const [error, setError] = useState(null);   // displayable error message
  const [loading, setLoading] = useState(true); // initial loading state

  // Callback to update vote counts when a post is voted on
  const handleVoteUpdate = (postId, upVoteCount, downVoteCount) => {
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.post_id === postId
          ? { ...item, up_vote_count: upVoteCount, down_vote_count: downVoteCount }
          : item
      )
    );
  };

  useEffect(() => {
    let alive = true;
    const abortController = new AbortController();
    const signal = abortController.signal;

    async function load() {
      try {
        // Get signed-in user from cookie session
        const meRes = await fetch("/auth/me", {
          credentials: "include",
          signal,
        });
        if (meRes.ok) {
          const me = await meRes.json().catch(() => null);
          if (alive) {
            setCurrentUserId(me?.user_id || null);
            setCurrentUserName(me?.user_name || me?.email || null);
          }
        } else {
          // Not signed in (or session expired)
          if (alive) {
            setCurrentUserId(null);
            setCurrentUserName(null);
          }
        }

        // Fetch images + posts at the same time
        const [imgsRes, postsRes] = await Promise.all([
          fetch("/images", { credentials: "include", signal }),
          fetch("/community/posts", { credentials: "include", signal }),
        ]);

        if (!imgsRes.ok || !postsRes.ok) {
          throw new Error("Failed to load community data");
        }

        const imgs = await imgsRes.json().catch(() => ({}));
        const posts = await postsRes.json().catch(() => ({}));

        const images = imgs.items || [];
        const postItems = posts.items || [];

        // Build lookup table: image_id -> image data (for getting S3 URLs)
        const imageById = new Map(images.map((img) => [img.image_id, img]));

        // Start with posts (which are already filtered to public images)
        // and enrich with image data if available
        const merged = postItems.map((post) => {
          const img = imageById.get(post.image_id) || {};
          return { ...img, ...post }; // Post fields override image fields
        });

        if (alive) setItems(merged);
      } catch (e) {
        // Don't set error state if request was aborted due to unmount
        if (e.name === "AbortError") return;
        if (alive) setError(e?.message || "Failed to load community feed");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      abortController.abort(); // Cancel all pending fetch requests
      alive = false;
    };
  }, []);

  
  if (error) return <p>{error}</p>;
  if (loading) return <LoadingGrid />;
  if (!items.length) return <p>No community posts yet.</p>;

  return (
    <main>
      <section>
        <h2>Community Images</h2>

        <div className="comm_grid">
          {items.map((img) => (
            <PostBox
              key={img.post_id} 
              image={img}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              onVoteUpdate={handleVoteUpdate}
            />
          ))}
        </div>
      </section>
    </main>
  );
}