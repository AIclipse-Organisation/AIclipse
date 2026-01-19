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

        // Build lookup table so we can join quickly
        const postByImageId = new Map(postItems.map((p) => [p.image_id, p]));

        // Only keep images that have a matching community post
        const merged = images
          .map((img) => {
            const post = postByImageId.get(img.image_id);
            if (!post) return null;

            return { ...img, ...post }; // Combine image fields + post fields
          })
          .filter(Boolean);

        if (alive) setItems(merged);
      } catch (e) {
        // Don't set error state if request was aborted due to unmount
        if (e.name === "AbortError") return;
        if (alive) setError(e?.message || "Failed to load community feed");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load().catch((err) => {
      // Catch any unhandled errors from the load function
      // Don't set error state for aborted requests
      if (err.name === "AbortError") return;
      if (alive) {
        setError(err?.message || "Unexpected error loading community feed");
        setLoading(false);
      }
    });

    return () => {
      alive = false;
      abortController.abort(); // Cancel all pending fetch requests
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
            />
          ))}
        </div>
      </section>
    </main>
  );
}