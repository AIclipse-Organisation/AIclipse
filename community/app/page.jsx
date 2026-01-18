"use client";

import { useEffect, useState } from "react";
import PostBox from "./components/post/PostBox";
import LoadingGrid from "./components/common/LoadingGrid";

export default function Page() {
  const [images, setImages] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/community/images")
      .then((res) => res.json())
      .then((data) => setImages(data.items || []))
      .catch(() => setError("Failed to load community images"))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <p>{error}</p>;
  if (loading) return <LoadingGrid />;
  if (!images.length) return <p>No community images yet.</p>;

  return (
    <main>
      <section>
        <h2>Community Images1</h2>

        <div className="comm_grid">
          {images.map((img) => (
            <PostBox key={img.image_id} image={img} />
          ))}
        </div>
      </section>
    </main>
  );
}