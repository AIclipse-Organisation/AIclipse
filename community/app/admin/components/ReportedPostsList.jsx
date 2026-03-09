"use client";
import { useState, useEffect } from "react";
import { Card, CardBody, Spinner, Modal, ModalContent, useDisclosure, ScrollShadow, User } from "@heroui/react";
import { adminService } from "@/admin/admin.js";

export default function ReportedPostsList() {
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [reports, setReports] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchReports(); }, []);

  const fetchReports = async () => {
    try {
      setLoading(true);
      const [reportsData, imagesData] = await Promise.all([
        adminService.getReportedPosts(),
        fetch("/community/images", { credentials: "include" }).then(res => res.json())
      ]);
      const imageById = new Map((imagesData.items || []).map(img => [img.image_id, img]));
      const merged = (reportsData.items || []).map(post => ({ ...post, url: imageById.get(post.image_id)?.url }));
      setReports(merged);
    } finally { setLoading(false); }
  };

  const handleAction = async (postId, action) => {
    try {
      if (action === "delete") await adminService.hardDeletePost(postId);
      else await adminService.moderatePost({ post_id: postId, action });
      setReports(prev => prev.filter(p => p.post_id !== postId));
      onOpenChange(false);
    } catch (err) { alert(err.message); }
  };

  if (loading) return <div className="flex justify-center p-20 h-full items-center"><Spinner size="lg" color="warning" label="Scanning Reports..." /></div>;

  return (
    <div className="h-full flex flex-col overflow-hidden"> 
      <ScrollShadow className="flex-grow pb-12 pr-4 scrollbar-hide" size={40}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-10">
          {reports.map((post) => (
            <Card key={post.post_id} isPressable onPress={() => { setSelectedPost(post); onOpen(); }} 
              className="border border-white/5 shadow-2xl rounded-[3rem] bg-[#1a1a1a] group text-white">
              <CardBody className="p-0 flex flex-col">
                <div className="aspect-square bg-black/40 relative overflow-hidden">
                  <img src={post.url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 opacity-90 group-hover:opacity-100" alt="" />
                  <div className="absolute top-6 left-6 z-20">
                    <span className="bg-[#222222] text-[#CFB87C] text-[10px] font-black px-5 py-2 rounded-full shadow-2xl border border-white/5 uppercase tracking-widest">
                      {post.report_count} {post.report_count === 1 ? 'Report' : 'Reports'}
                    </span>
                  </div>
                </div>
                <div className="p-8">
                    <span className="font-black text-xs text-white uppercase tracking-tighter block mb-2">{post.user_name}</span>
                    <p className="text-xs text-gray-500 font-medium line-clamp-2 italic mb-6">"{post.description || "No description provided."}"</p>
                    <span className="text-[10px] font-black text-[#CFB87C] uppercase tracking-widest group-hover:translate-x-1 transition-transform inline-block">Review Post</span>
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
        size="5xl" 
        placement="center" 
        backdrop="blur" 
        scrollBehavior="inside"
        classNames={{ 
            base: "rounded-[3rem] bg-[#1a1a1a] text-white border border-white/5 shadow-2xl h-[80vh] max-h-[80vh] m-6 md:m-12 max-w-[95vw]", 
            body: "p-0 overflow-hidden",
            closeButton: "top-6 right-6 text-[#CFB87C] hover:bg-white/10 transition-all text-xl z-50",
        }}
      >
        <ModalContent>
          {(onClose) => (
            <div className="flex flex-col md:flex-row h-full">
              {/* LEFT SIDE: Entire Image */}
              <div className="w-full md:w-3/5 bg-black/60 flex items-center justify-center p-6 border-r border-white/5 h-full">
                <img src={selectedPost?.url} className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl" alt="" />
              </div>

              {/* RIGHT SIDE: Header + Meta + Footer */}
              <div className="w-full md:w-2/5 flex flex-col bg-[#1a1a1a] h-full">
                <div className="p-8 border-b border-white/5">
                  <p className="text-gray-500 text-[8px] font-black uppercase tracking-[0.3em]">REF ID: {selectedPost?.post_id}</p>
                </div>

                <div className="p-8 border-b border-white/5 bg-white/5">
                  <label className="text-[10px] font-black text-[#CFB87C] uppercase tracking-widest mb-3 block">Poster Context</label>
                  <p className="text-xs font-bold leading-relaxed mb-5 italic text-gray-300">"{selectedPost?.description}"</p>
                  <User 
                    name={selectedPost?.user_name} 
                    description={`Posted ${new Date(selectedPost?.created_at).toLocaleDateString()}`} 
                    avatarProps={{ className: "bg-[#CFB87C] text-[#222222] font-black" }} 
                    className="font-black uppercase text-[10px] text-white" 
                  />
                </div>

                <ScrollShadow className="flex-1 p-8 min-h-0 scrollbar-hide">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-6 block">Community Complaints ({selectedPost?.report_history?.length || 0})</label>
                  <div className="flex flex-col gap-5">
                    {selectedPost?.report_history?.map((rep, i) => (
                      <div key={i} className="p-5 bg-white/5 rounded-2xl border border-white/5">
                        <div className="flex justify-between items-center mb-2">
                           <span className="text-[#CFB87C] text-[8px] font-black uppercase tracking-widest">{rep.reason || "General Flag"}</span>
                           <span className="text-[8px] text-gray-700 font-bold">{new Date(rep.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="text-xs text-gray-400 italic">"{rep.details || "No additional context provided."}"</p>
                      </div>
                    ))}
                  </div>
                </ScrollShadow>

                <div className="p-8 bg-black/40 border-t border-white/5 flex flex-wrap gap-4 mt-auto">
                  <div className="flex gap-4 w-full">
                    <button className="flex-1 bg-white/5 text-white border border-white/10 font-black py-4 rounded-xl text-[9px] uppercase tracking-widest hover:bg-white/10 transition-all" onClick={() => handleAction(selectedPost.post_id, "dismiss")}>Dismiss</button>
                    <button className="flex-1 bg-white/5 text-white border border-orange-500/20 font-black py-4 rounded-xl text-[9px] uppercase tracking-widest hover:bg-white/10" onClick={() => handleAction(selectedPost.post_id, "remove")}>Remove</button>
                  </div>
                  <button className="w-full bg-red-600 text-white font-black py-5 rounded-xl text-[10px] uppercase tracking-widest shadow-xl hover:bg-red-700 transition-all" onClick={() => handleAction(selectedPost.post_id, "delete")}>Delete</button>
                </div>
              </div>
            </div>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}