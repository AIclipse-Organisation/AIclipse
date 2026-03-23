"use client";

import { useEffect, useState, useRef, useCallback } from "react"; // Added useRef and useCallback
import PostBox from "./components/post/PostBox";
import LoadingGrid from "./components/common/LoadingGrid";

export default function Page() {
  const [items, setItems] = useState([]);

  // session info (needed for voting/commenting inside PostBox)
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserName, setCurrentUserName] = useState(null);

  const [error, setError] = useState(null); // displayable error message
  const [loading, setLoading] = useState(false); // Changed to false initially to allow controlled triggers
  const [hasMore, setHasMore] = useState(true); // Track if there are more pages
  const [page, setPage] = useState(1);
  const [initialLoad, setInitialLoad] = useState(true); // Dedicated initial loading state

  const observerTarget = useRef(null); // Sentinel ref for infinite scroll

  const imageMapRef = useRef(new Map());
  const loadPosts = useCallback(
    async (pageNum, signal) => {
      if (loading) return;
      setLoading(true);

      try {
        // 1. Fetch the paginated posts
        const postsRes = await fetch(
          `/community/posts?page=${pageNum}&limit=12`,
          { credentials: "include", signal },
        );
        if (!postsRes.ok) throw new Error("Failed to load posts");

        const posts = await postsRes.json().catch(() => ({}));
        const postItems = posts.items || [];

        // 2. THE FIX: Fetch the images ONLY on page 1 (or if our cache is empty)
        if (pageNum === 1 || imageMapRef.current.size === 0) {
          const imgsRes = await fetch("/community/images", {
            credentials: "include",
            signal,
          });
          if (imgsRes.ok) {
            const imgs = await imgsRes.json().catch(() => ({}));
            const imagesList = imgs.items || [];
            // Store in a Ref so it persists across infinite scrolls without triggering React re-renders
            imageMapRef.current = new Map(
              imagesList.map((img) => [img.image_id, img]),
            );
          }
        }

        // 3. Merge the posts with our cached image URLs
        const merged = postItems.map((post, index) => {
          // Grab the image data (with the proper URL) from our cache
          const img = imageMapRef.current.get(post.image_id) || {};

          // --- MVP TRENDING FIX ---
          const hasEngagement =
            Number(post.up_vote_count) > 0 || Number(post.comment_count) > 0;
          const isTrending = pageNum === 1 && index < 3 && hasEngagement;

          return { ...img, ...post, isTrending };
        });

        // Append items if page > 1, replace if page 1
        setItems((prev) => (pageNum === 1 ? merged : [...prev, ...merged]));

        setHasMore(posts.hasMore ?? merged.length >= 12);
      } catch (e) {
        if (e.name !== "AbortError") {
          setError(e?.message || "Failed to load community feed");
        }
      } finally {
        setLoading(false);
        setInitialLoad(false);
      }
    },
    [loading],
  );

  // Callback to update vote counts when a post is voted on
  const handleVoteUpdate = (postId, upVoteCount, downVoteCount) => {
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.post_id === postId
          ? {
              ...item,
              up_vote_count: upVoteCount,
              down_vote_count: downVoteCount,
            }
          : item,
      ),
    );
  };

  // Callback to remove a post from the list when it's deleted
  const handlePostDelete = (postId) => {
    setItems((prevItems) =>
      prevItems.filter((item) => item.post_id !== postId),
    );
  };

  // --- INITIAL DATA LOAD (Session + Page 1) ---
  useEffect(() => {
    let alive = true;
    const abortController = new AbortController();
    const signal = abortController.signal;

    async function init() {
      try {
        const meRes = await fetch("/auth/me", {
          credentials: "include",
          signal,
        });
        const contentType = meRes.headers.get("content-type");

        if (contentType && contentType.includes("text/html")) {
          window.location.href = "/";
          return;
        }

        if (meRes.ok) {
          const me = await meRes.json().catch(() => null);
          if (alive) {
            setCurrentUserId(me?.user_id || null);
            setCurrentUserName(me?.user_name || me?.email || null);
          }
        }

        // Initial load of first page
        await loadPosts(1, signal);
      } catch (err) {
        console.error(err);
      }
    }

    init();

    return () => {
      abortController.abort();
      alive = false;
    };
  }, []);

  // --- INFINITE SCROLL OBSERVER ---
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // If bottom sentinel is visible and we aren't already loading...
        if (entries[0].isIntersecting && hasMore && !loading && !initialLoad) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1, rootMargin: "300px" }, // Start loading 300px before reaching bottom
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loading, initialLoad]);

  // --- TRIGGER LOADING ON PAGE CHANGE ---
  useEffect(() => {
    if (page > 1) {
      loadPosts(page);
    }
  }, [page]);

  if (error) return <p>{error}</p>;
  if (initialLoad) return <LoadingGrid count={3} />;

  if (!items.length && !loading)
    return (
      <div className="empty-state">
        <div className="empty-card">
          <img
            className="empty-icon-image"
            src="/static/images/community_icon.png"
            alt="Community"
          />
          <p className="empty-text">No community posts yet.</p>
        </div>
      </div>
    );

  return (
    <main>
      <section>
        <div className="comm_grid">
          {items.map((img) => (
            <PostBox
              key={img.post_id}
              image={img}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              onVoteUpdate={handleVoteUpdate}
              onPostDelete={handlePostDelete}
            />
          ))}
        </div>

        {/* SENTINEL: This invisible div detects the bottom scroll */}
        <div ref={observerTarget} className="flex justify-center py-10 w-full">
          {loading && (
            <div className="animate-pulse text-gray-400 text-sm">
              Loading more items...
            </div>
          )}
          {!hasMore && items.length > 0 && (
            <p className="text-gray-400 text-sm italic">
              You've seen everything!
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
