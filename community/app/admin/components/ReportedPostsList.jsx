"use client";
import { useState, useEffect } from "react";
import { Card, CardBody, Spinner, Modal, ModalContent, useDisclosure, ScrollShadow } from "@heroui/react";
import { adminService } from "../admin.js";

export default function ReportedPostsList() {
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [reports, setReports] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchReports(); }, []);

  const fetchReports = async () => {
    try {
      setLoading(true);
      const reportsData = await adminService.getReportedPosts();
      setReports(Array.isArray(reportsData.items) ? reportsData.items : []);
    } finally { setLoading(false); }
  };

  const handleAction = async (postId, action) => {
    try {
      if (action === "delete") {
        await adminService.hardDeletePost(postId);
      } else {
        const note = action === "remove"
          ? "Content removed by moderation team"
          : "Report dismissed by moderation team";
        await adminService.moderatePost({ post_id: postId, action, note });
      }
      setReports(prev => prev.filter(p => p.post_id !== postId));
      onOpenChange(false);
    } catch (err) { alert(err.message); }
  };

  if (loading) return <div className="flex justify-center p-20 h-full items-center"><Spinner size="lg" color="warning" label="Scanning Reports..." /></div>;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ScrollShadow className="flex-grow pb-8 md:pb-12 pr-1 md:pr-4 scrollbar-hide" size={40}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-10">
          {reports.map((post) => (
            <Card key={post.post_id} isPressable onPress={() => { setSelectedPost(post); onOpen(); }}
              className="border border-white/5 shadow-2xl rounded-[1.75rem] md:rounded-[3rem] bg-[#1a1a1a] group text-white">
              <CardBody className="p-0 flex flex-col">
                <div className="aspect-square bg-black/40 relative overflow-hidden">
                  <img src={post.url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 opacity-90 group-hover:opacity-100" alt="" />
                  <div className="absolute top-6 left-6 z-20">
                    <span className="bg-[#222222] text-[#CFB87C] text-xs font-black px-5 py-2 rounded-full shadow-2xl border border-white/5 uppercase tracking-wide">
                      {post.report_count} {post.report_count === 1 ? 'Report' : 'Reports'}
                    </span>
                  </div>
                </div>
                <div className="p-4 md:p-8">
                  <span className="font-black text-xs text-white uppercase tracking-tighter block mb-2">{post.user_name}</span>
                  <p className="text-xs text-gray-500 font-medium line-clamp-2 italic mb-6">"{post.description || "No description provided."}"</p>
                  <span className="text-xs font-black text-[#CFB87C] uppercase tracking-wide group-hover:translate-x-1 transition-transform inline-block">Review Post</span>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </ScrollShadow>

      {/* FIXED MODAL: Locked to 80% height, centered, and margins from screen edges */}
      <Modal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        size="full"
        placement="center"
        backdrop="blur"
        scrollBehavior="inside"
        classNames={{
          base: "rounded-[1.75rem] md:rounded-[3rem] bg-[#1a1a1a] text-white border border-white/5 shadow-2xl h-[92vh] md:h-[80vh] max-h-[92vh] md:max-h-[80vh] m-2 md:m-12 max-w-[98vw] md:max-w-[95vw]",
          body: "p-0 overflow-hidden",
          closeButton: "top-3 md:top-6 right-3 md:right-6 text-[#CFB87C] hover:bg-white/10 transition-all text-xl z-50",
        }}
      >
        <ModalContent>
          {(onClose) => (
            <div className="flex flex-col md:flex-row h-full">
              {/* LEFT SIDE: Entire Image */}
              <div className="w-full md:w-3/5 bg-black/60 flex items-center justify-center p-3 md:p-6 border-b md:border-b-0 md:border-r border-white/5 h-[34vh] md:h-full">
                <img src={selectedPost?.url} className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl" alt="" />
              </div>

              {/* RIGHT SIDE: Header + Meta + Footer */}
              <div className="w-full md:w-2/5 flex flex-col bg-[#1a1a1a] h-full">
                <div className="p-4 md:p-8 border-b border-white/5">
                  <p className="text-gray-500 text-xs font-black uppercase tracking-wide">REF ID: {selectedPost?.post_id}</p>
                </div>

                <div className="p-4 md:p-8 border-b border-white/5 bg-white/5">
                  <label className="text-sm font-black text-[#CFB87C] uppercase tracking-wide mb-3 block">Poster Context</label>
                  <p className="text-xs font-bold leading-relaxed mb-5 italic text-gray-300">"{selectedPost?.description}"</p>
                  <div className="flex flex-col">
                    <span className="text-white font-black uppercase text-xs">{selectedPost?.user_name}</span>
                    <span className="text-gray-500 text-[10px] font-bold mt-1">
                      POSTED {new Date(selectedPost?.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <ScrollShadow className="flex-1 p-4 md:p-8 min-h-0 scrollbar-hide">
                  <label className="text-sm font-black text-gray-500 uppercase tracking-wide mb-6 block">Community Complaints ({selectedPost?.report_history?.length || 0})</label>
                  <div className="flex flex-col gap-5">
                    {selectedPost?.report_history?.map((rep, i) => (
                      <div key={i} className="p-4 md:p-5 bg-white/5 rounded-2xl border border-white/5">
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 mb-2">
                          <span className="text-[#CFB87C] text-xs font-black uppercase tracking-wide">{rep.reason || "General Flag"}</span>
                          <span className="text-xs text-gray-700 font-bold">{new Date(rep.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="text-xs text-gray-400 italic">"{rep.details || "No additional context provided."}"</p>
                      </div>
                    ))}
                  </div>
                </ScrollShadow>

                <div className="p-4 md:p-8 bg-black/40 border-t border-white/5 flex flex-wrap gap-3 md:gap-4 mt-auto">
                  <div className="flex flex-col sm:flex-row gap-3 md:gap-4 w-full">
                    <button className="flex-1 bg-white/5 text-white border border-white/10 font-black py-4 rounded-xl text-xs uppercase tracking-wide hover:bg-white/10 transition-all" onClick={() => handleAction(selectedPost.post_id, "dismiss")}>Dismiss</button>
                    <button className="flex-1 bg-white/5 text-white border border-orange-500/20 font-black py-4 rounded-xl text-xs uppercase tracking-wide hover:bg-white/10" onClick={() => handleAction(selectedPost.post_id, "remove")}>Remove</button>
                  </div>
                  <button className="w-full bg-red-600 text-white font-black py-5 rounded-xl text-sm uppercase tracking-wide shadow-xl hover:bg-red-700 transition-all" onClick={() => handleAction(selectedPost.post_id, "delete")}>Delete</button>
                </div>
              </div>
            </div>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
