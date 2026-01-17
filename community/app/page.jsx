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

    async function load() {
      try {
        //get signed-in user from cookie session
        const meRes = await fetch("/auth/me", { credentials: "include" }); // include cookies
        if (meRes.ok) {
          const me = await meRes.json().catch(() => null);
          if (alive) {
            setCurrentUserId(me?.user_id || null);                 // used for vote/comment
            setCurrentUserName(me?.user_name || me?.email || null); // shown on comments
          }
        } else {
          // not signed in (or session expired)
          if (alive) {
            setCurrentUserId(null);
            setCurrentUserName(null);
          }
        }

        //  fetch images + posts at the same time 
        const [imgsRes, postsRes] = await Promise.all([
          fetch("/images", { credentials: "include" }),
          fetch("/community/posts", { credentials: "include" }),
        ]);

       
        if (!imgsRes.ok || !postsRes.ok) {
          throw new Error("Failed to load community data");
        }

      
        const imgs = await imgsRes.json().catch(() => ({}));
        const posts = await postsRes.json().catch(() => ({}));

        const images = imgs.items || [];
        const postItems = posts.items || [];

        //  build lookup table so we can join quickly 
        const postByImageId = new Map(postItems.map((p) => [p.image_id, p]));

        //  only keep images that have a matching community post
        const merged = images
          .map((img) => {
            const post = postByImageId.get(img.image_id);
            if (!post) return null;

            

            return { ...img, ...post }; // combine image fields + post fields
          })
          .filter(Boolean);

        if (alive) setItems(merged);
      } catch (e) {
        if (alive) setError(e?.message || "Failed to load community feed");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    
    return () => {
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
            />
          ))}
        </div>
      </section>
    </main>
  );
}