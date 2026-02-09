"use client";
import { Card,CardBody, Button, Input, Chip,User } from "@heroui/react";

export default function UserManagement() {
  // Mock Data
  const users = [
    { id: 1, name: "Alice Johnson", email: "alice@example.com", role: "Admin", status: "Active" },
    { id: 2, name: "Bob Smith", email: "bob@example.com", role: "User", status: "Active" },
    { id: 3, name: "Charlie Day", email: "charlie@example.com", role: "User", status: "Suspended" },
    { id: 4, name: "Dana White", email: "dana@example.com", role: "Moderator", status: "Active" },
    { id: 5, name: "Evan Wright", email: "evan@example.com", role: "User", status: "Active" },
  ];

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-10">
      
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
            <h2 className="text-2xl font-bold text-gray-800">User Management</h2>
            <p className="text-gray-500 text-sm">Manage access, roles, and user status.</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
            <Input 
                placeholder="Search users..." 
                size="sm" 
                className="w-full md:w-64 bg-white"
                startContent={<span className="text-gray-400">🔍</span>}
            />
            <Button color="primary" size="sm">Add User</Button>
        </div>
      </div>

      {/* Users Table Card */}
      <Card className="border-none shadow-sm bg-white flex-1" radius="lg">
        <CardBody className="p-0">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 p-4 border-b border-gray-100 bg-gray-50/50 text-xs font-bold text-gray-400 uppercase tracking-wider">
                <div className="col-span-4">User</div>
                <div className="col-span-3">Role</div>
                <div className="col-span-3">Status</div>
                <div className="col-span-2 text-right">Actions</div>
            </div>

            {/* Table Rows */}
            <div className="divide-y divide-gray-50">
                {users.map((user) => (
                    <div key={user.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-gray-50 transition-colors">
                        
                        {/* User Column */}
                        <div className="col-span-4">
                            <User   
                                name={user.name}
                                description={user.email}
                                avatarProps={{
                                    src: `https://i.pravatar.cc/150?u=${user.id}`,
                                    size: "sm"
                                }}
                            />
                        </div>

                        {/* Role Column */}
                        <div className="col-span-3">
                            <div className="text-sm text-gray-600 font-medium">{user.role}</div>
                        </div>

                        {/* Status Column */}
                        <div className="col-span-3">
                            <Chip 
                                size="sm" 
                                variant="flat" 
                                color={user.status === "Active" ? "success" : "danger"}
                                className="capitalize"
                            >
                                {user.status}
                            </Chip>
                        </div>

                        {/* Actions Column */}
                        <div className="col-span-2 flex justify-end gap-2">
                            <button className="text-gray-400 hover:text-blue-600 text-sm font-medium transition-colors">
                                Edit
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </CardBody>
        
        {/* Pagination Footer Mockup */}
        <div className="p-4 border-t border-gray-100 flex justify-center">
            <div className="flex gap-2">
                <Button size="sm" variant="light" isDisabled>Previous</Button>
                <Button size="sm" variant="flat">1</Button>
                <Button size="sm" variant="light">2</Button>
                <Button size="sm" variant="light">3</Button>
                <Button size="sm" variant="light">Next</Button>
            </div>
        </div>
      </Card>
    </div>
  );
}