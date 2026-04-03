"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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
  const loadPosts = useCallback(
    async (pageNum, signal) => {
      if (loading) return;
      setLoading(true);

      try {
        const postsRes = await fetch(
          `/community/posts?page=${pageNum}&limit=12`,
          { credentials: "include", signal },
        );
        if (!postsRes.ok) throw new Error("Failed to load posts");

        const posts = await postsRes.json().catch(() => ({}));
        const postItems = posts.items || [];

        const merged = postItems.map((post, index) => {
          const hasEngagement =
            Number(post.up_vote_count) > 0 || Number(post.comment_count) > 0;
          const isTrending = pageNum === 1 && index < 3 && hasEngagement;

          return { ...post, isTrending };
        });

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

        await loadPosts(1, signal);
      } catch (err) {
        if (err.name !== "AbortError") console.error(err);
      }
    }

    init();

    return () => {
      abortController.abort();
      alive = false;
    };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !initialLoad) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1, rootMargin: "300px" },
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loading, initialLoad]);

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
