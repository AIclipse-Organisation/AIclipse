"use client";
import { useEffect, useState } from "react";
import { Card, CardBody, Badge, User, Button, Spinner } from "@heroui/react";

export default function AdminPage() {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        const res = await fetch("/community/posts");
        const data = await res.json();
        setItems(data.items || data || []);
      } catch (error) {
        console.error("Failed to fetch admin data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPosts();
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Spinner label="Loading ..." color="warning" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Community Overview</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card shadow="sm">
          <CardBody>
            <p className="text-gray-500 text-sm">TOTAL POSTS</p>
            <p className="text-2xl font-bold">{items.length}</p>
          </CardBody>
        </Card>

        <Card shadow="sm" className="bg-red-50">
          <CardBody>
            <p className="text-red-500 text-sm font-bold">FLAGGED</p>
            <p className="text-2xl font-bold text-red-600">
                {items.filter(i => (i.report_count || 0) > 0).length}
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Post Moderation</h2>
        <div className="grid grid-cols-1 gap-4">
          {items.length === 0 ? (
            <p className="text-gray-500 italic">No posts found.</p>
          ) : (
            items.map((item) => (
              <Card key={item.post_id} className="p-4" isHoverable>
                <div className="flex justify-between items-center">
                  <User 
                    name={item.user_name || "Unknown User"}
                    description={item.timestamp}
                    avatarProps={{ src: item.avatar_url }}
                  />
                  <div className="flex gap-2 items-center">
                    {(item.report_count || 0) > 0 && (
                      <Badge color="danger" variant="flat">
                        {item.report_count} Reports
                      </Badge>
                    )}
                    <Button size="sm" color="danger" variant="flat">Delete</Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}