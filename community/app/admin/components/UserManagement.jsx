"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Card,
    CardBody,
    Button,
    Input,
    Chip,
    Select,
    SelectItem,
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    Textarea,
    Spinner,
} from "@heroui/react";
import { adminService } from "../admin";

const FOUND_US_LABELS = {
    social_media: "Social Media",
    browsing: "Browsing",
    friend_or_colleague: "Friend / Colleague",
    news_article: "News Article",
    youtube: "YouTube",
    linkedin: "LinkedIn",
    other: "Other",
};

const DELETE_REASON_OPTIONS = [
    { key: "test_purpose", label: "Deleting for test purposes" },
    { key: "user_request", label: "User requested deletion" },
    { key: "spam_abuse", label: "Spam / abuse" },
    { key: "security", label: "Security issue" },
    { key: "other", label: "Other (specify)" },
];

const SELECT_DROPDOWN_CLASSES = {
    trigger: "h-9 min-h-9 bg-[#0b0b0b] border border-white/20 text-white shadow-sm data-[hover=true]:border-white/30 data-[focus=true]:border-[#CFB87C] data-[focus=true]:shadow-none",
    value: "text-white",
    selectorIcon: "text-white/80 top-1/2 -translate-y-1/2",
    innerWrapper: "pr-7",
    popoverContent: "bg-[#141414] border border-white/10 text-white",
    listbox: "bg-[#141414]",
};

const MANUAL_FORM_DEFAULT = {
    user_name: "",
    email: "",
    password: "",
    date_of_birth: "",
};

const PASSWORD_POLICY_RULES = [
    { id: "min_length", text: "At least 8 characters" },
    { id: "max_length", text: "At most 72 characters" },
    { id: "no_spaces", text: "No spaces" },
    { id: "has_lowercase", text: "At least one lowercase letter (a-z)" },
    { id: "has_uppercase", text: "At least one uppercase letter (A-Z)" },
    { id: "has_number", text: "At least one number (0-9)" },
    { id: "has_symbol", text: "At least one symbol (for example !@#$)" },
];

const GOLD_BUTTON_BASE = "font-black uppercase tracking-wide rounded-2xl bg-[#CFB87C] text-[#111] hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100";
const GOLD_BUTTON_SM = `${GOLD_BUTTON_BASE} h-9 px-4 text-xs`;
const GOLD_BUTTON_MD = `${GOLD_BUTTON_BASE} h-10 px-5 text-sm`;
const BUTTON_INACTIVE = "h-12 rounded-xl font-black uppercase tracking-wide text-white/70 bg-transparent border border-white/10";
const LOWERCASE_CHARS = "abcdefghjkmnpqrstuvwxyz";
const UPPERCASE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const NUMBER_CHARS = "23456789";
const SYMBOL_CHARS = "!@#";
const PASSWORD_CHARS = `${LOWERCASE_CHARS}${UPPERCASE_CHARS}${NUMBER_CHARS}${SYMBOL_CHARS}`;

function formatDate(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
}

function getSelectedKey(selection, fallback) {
    if (selection == null) return fallback;
    if (typeof selection === "string") return selection;

    if (typeof selection === "object" && "currentKey" in selection && selection.currentKey != null) {
        return String(selection.currentKey);
    }

    if (selection[Symbol.iterator]) {
        const first = Array.from(selection)[0];
        if (first != null) return String(first);
    }

    return fallback;
}

function secureRandomInt(maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error("maxExclusive must be a positive integer");
    }

    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) {
        throw new Error("Secure random generation is unavailable in this environment");
    }

    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    const buffer = new Uint32Array(1);

    do {
        cryptoApi.getRandomValues(buffer);
    } while (buffer[0] >= limit);

    return buffer[0] % maxExclusive;
}

function randomFrom(list) {
    return list[secureRandomInt(list.length)];
}

function secureShuffle(list) {
    const shuffled = [...list];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = secureRandomInt(index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

function generatePassword(length = 14) {
    const chars = [
        randomFrom(LOWERCASE_CHARS),
        randomFrom(UPPERCASE_CHARS),
        randomFrom(NUMBER_CHARS),
        randomFrom(SYMBOL_CHARS),
    ];

    while (chars.length < length) {
        chars.push(randomFrom(PASSWORD_CHARS));
    }

    return secureShuffle(chars).join("");
}

function calculateAgeFromDateString(dateString) {
    const match = String(dateString || "").trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const dob = new Date(year, month - 1, day);

    if (
        Number.isNaN(dob.getTime()) ||
        dob.getFullYear() !== year ||
        dob.getMonth() !== month - 1 ||
        dob.getDate() !== day
    ) {
        return null;
    }

    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const hasBirthdayPassed =
        today.getMonth() > dob.getMonth() ||
        (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
    if (!hasBirthdayPassed) age -= 1;
    return age;
}

function randomDateOfBirth() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const latestDob = new Date(today);
    latestDob.setFullYear(today.getFullYear() - 18);

    const earliestDob = new Date(today);
    earliestDob.setFullYear(today.getFullYear() - 150);

    const daysRange = Math.floor((latestDob.getTime() - earliestDob.getTime()) / 86400000);
    const dayOffset = secureRandomInt(daysRange + 1);
    const dob = new Date(earliestDob.getTime() + dayOffset * 86400000);
    const dd = String(dob.getDate()).padStart(2, "0");
    const mm = String(dob.getMonth() + 1).padStart(2, "0");
    const yyyy = String(dob.getFullYear());
    return `${dd}-${mm}-${yyyy}`;
}

function generateAutoUser() {
    const first = randomFrom([
    "Ava", "Noah", "Liam", "Mia", "Eli", "Nova", "Zoe", "Kai",
    "Luca", "Aria", "Ezra", "Ivy", "Leo", "Mila", "Theo", "Luna",
    "Jade", "Axel", "Ruby", "Finn", "Iris", "Silas", "Nina", "Rowan",
    "Sage", "Eden", "Zara", "Milo"
    ]);

const last = randomFrom([
    "Stone", "River", "Blake", "Hayes", "Hart", "Lane", "Wynn", "Lee",
    "Brooks", "Vale", "Reed", "Shaw", "Cruz", "Drake", "Fox", "Quinn",
    "Ridge", "Snow", "Voss", "West", "Clarke", "Blaire", "Sloane", "Pierce",
    "Hale", "Knox", "Rowe", "Sterling"
    ]);
    const name = `${first} ${last}`;
    const slug = `${first}${last}`.toLowerCase();
    const id = secureRandomInt(9000) + 1000;
    const email = `${slug}${id}@example.com`;
    const password = generatePassword();
    const date_of_birth = randomDateOfBirth();
    return { user_name: name, email, password, date_of_birth };
}

function checkPasswordStrength(password) {
    if (password == null) {
        return PASSWORD_POLICY_RULES.reduce((acc, rule) => {
            acc[rule.id] = false;
            return acc;
        }, {});
    }

    const bytes = new TextEncoder().encode(password);
    return {
        min_length: bytes.length >= 8,
        max_length: bytes.length <= 72,
        no_spaces: !/\s/.test(password),
        has_lowercase: /[a-z]/.test(password),
        has_uppercase: /[A-Z]/.test(password),
        has_number: /\d/.test(password),
        has_symbol: /[^A-Za-z0-9]/.test(password),
    };
}

export default function UserManagement() {
    const [users, setUsers] = useState([]);
    const [page, setPage] = useState(1);
    const pageSize = 20;
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState("created_at_desc");
    const [accessStatusFilter, setAccessStatusFilter] = useState("all");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [createError, setCreateError] = useState("");
    const [deleteError, setDeleteError] = useState("");

    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [createMode, setCreateMode] = useState("manual");
    const [manualForm, setManualForm] = useState(MANUAL_FORM_DEFAULT);
    const [autoUser, setAutoUser] = useState(generateAutoUser());
    const [createResult, setCreateResult] = useState(null);
    const [creating, setCreating] = useState(false);

    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [targetUser, setTargetUser] = useState(null);
    const [deleteReason, setDeleteReason] = useState("test_purpose");
    const [deleteDetail, setDeleteDetail] = useState("");
    const [deleting, setDeleting] = useState(false);

    const [auditLogs, setAuditLogs] = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [logPage, setLogPage] = useState(1);
    const [logsHasMore, setLogsHasMore] = useState(false);
    const [activeTab, setActiveTab] = useState("users");
    const [accessRequests, setAccessRequests] = useState([]);
    const [accessTotal, setAccessTotal] = useState(0);
    const [accessPage, setAccessPage] = useState(1);
    const [accessLoading, setAccessLoading] = useState(false);
    const [accessError, setAccessError] = useState("");
    const [accessActionBusyUserId, setAccessActionBusyUserId] = useState("");

    const sortParams = useMemo(() => {
        const parts = sort.split("_");
        const order = parts.pop() || "desc";
        const field = parts.join("_") || "created_at";
        return { sort: field, order };
    }, [sort]);

    useEffect(() => {
        loadUsers(1);
        loadLogs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => loadUsers(1), 250);
        return () => clearTimeout(timer);
    }, [search, sort, accessStatusFilter]);

    async function loadUsers(nextPage = 1) {
        setLoading(true);
        setError("");
        try {
            const isAdminFilter =
                accessStatusFilter === "admin"
                    ? true
                    : accessStatusFilter === "approved"
                        ? false
                        : undefined;

            const accessStatusParam =
                accessStatusFilter === "approved" || accessStatusFilter === "pending" || accessStatusFilter === "rejected"
                    ? accessStatusFilter
                    : undefined;

            const params = {
                page: nextPage,
                page_size: pageSize,
                search: search || undefined,
                is_admin: isAdminFilter,
                access_status: accessStatusParam,
                sort: sortParams.sort,
                order: sortParams.order,
            };

            const data = await adminService.getUsers(params);
            setUsers(data?.items || []);
            setTotal(data?.total || 0);
            setPage(nextPage);
        } catch (err) {
            setError(err?.message || "Failed to load users");
        } finally {
            setLoading(false);
        }
    }

    async function loadLogs(nextPage = 1) {
        setLoadingLogs(true);
        try {
            const data = await adminService.getDeletionLogs({ page: nextPage, page_size: pageSize });
            const items = Array.isArray(data) ? data : [];
            setAuditLogs(items);
            setLogPage(nextPage);
            setLogsHasMore(items.length === pageSize);
        } catch (err) {
            console.warn("Failed to load audit logs", err);
        } finally {
            setLoadingLogs(false);
        }
    }

    async function loadAccessRequests(nextPage = 1) {
        setAccessLoading(true);
        setAccessError("");
        try {
            const data = await adminService.getAccessRequests({
                page: nextPage,
                page_size: pageSize,
                search: search || undefined,
            });
            setAccessRequests(data?.items || []);
            setAccessTotal(data?.total || 0);
            setAccessPage(nextPage);
        } catch (err) {
            setAccessError(err?.message || "Failed to load access requests");
        } finally {
            setAccessLoading(false);
        }
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const accessTotalPages = Math.max(1, Math.ceil(accessTotal / pageSize));
    const passwordChecks = useMemo(() => checkPasswordStrength(manualForm.password || ""), [manualForm.password]);
    const hasTypedPassword = Boolean((manualForm.password || "").length);
    const isManualPasswordValid = Object.values(passwordChecks).every(Boolean);

    const handleManualChange = (field, value) => {
        setManualForm((prev) => ({ ...prev, [field]: value }));
    };

    function resetCreateState() {
        setManualForm(MANUAL_FORM_DEFAULT);
        setAutoUser(generateAutoUser());
        setCreateResult(null);
        setCreateMode("manual");
    }

    async function handleCreateUser() {
        if (createMode === "manual" && !String(manualForm.date_of_birth || "").trim()) {
            setCreateError("Date of birth is required for manual user creation.");
            return;
        }
        if (createMode === "manual" && !/^\d{2}-\d{2}-\d{4}$/.test(String(manualForm.date_of_birth || ""))) {
            setCreateError("Date of birth must be in DD-MM-YYYY format.");
            return;
        }
        if (createMode === "manual") {
            const parsedAge = calculateAgeFromDateString(manualForm.date_of_birth);
            if (!Number.isInteger(parsedAge)) {
                setCreateError("Please provide a valid date of birth.");
                return;
            }
            if (parsedAge < 18) {
                setCreateError("User must be 18 or older.");
                return;
            }
            if (parsedAge > 150) {
                setCreateError("Please provide a valid date of birth.");
                return;
            }
        }
        if (createMode === "manual" && hasTypedPassword && !isManualPasswordValid) {
            setCreateError("Password does not meet password requirements.");
            return;
        }

        setCreating(true);
        setCreateError("");
        setCreateResult(null);
        try {
            const payload = createMode === "manual"
                ? {
                        user_name: manualForm.user_name.trim(),
                        email: manualForm.email.trim(),
                        password: manualForm.password.trim() || undefined,
                        is_admin: false,
                        date_of_birth: manualForm.date_of_birth,
                    }
                : {
                        user_name: autoUser.user_name,
                        email: autoUser.email,
                        password: autoUser.password,
                        date_of_birth: autoUser.date_of_birth,
                        is_admin: false,
                    };

            const data = await adminService.createUser(payload);
            setCreateResult(data);
            setManualForm(MANUAL_FORM_DEFAULT);
            setAutoUser(generateAutoUser());
            setCreateError("");
            await loadUsers(1);
        } catch (err) {
            setCreateError(err?.message || "Failed to create user");
        } finally {
            setCreating(false);
        }
    }

    function openDelete(user) {
        setTargetUser(user);
        setDeleteReason("test_purpose");
        setDeleteDetail("");
        setDeleteError("");
        setDeleteModalOpen(true);
    }

    async function handleDeleteUser() {
        if (!targetUser) return;
        setDeleting(true);
        setDeleteError("");
        try {
            const payload = {
                reason_code: deleteReason,
                reason_detail: deleteReason === "other" ? deleteDetail : deleteDetail || null,
            };
            await adminService.deleteUser(targetUser.user_id, payload);
            setDeleteModalOpen(false);
            setTargetUser(null);
            setDeleteError("");
            await Promise.all([loadUsers(page), loadLogs(logPage)]);
        } catch (err) {
            setDeleteError(err?.message || "Failed to delete user");
        } finally {
            setDeleting(false);
        }
    }

    const rows = users.map((user) => (
        <div key={user.user_id} className="grid grid-cols-12 gap-4 p-3 items-center hover:bg-white/5 transition-colors">
            <div className="col-span-5">
                <div className="text-sm font-semibold text-white leading-tight">{user.user_name}</div>
                <div className="text-xs text-white/60 leading-tight">{user.email}</div>
                <div className="text-[11px] text-white/50 mt-1">Created {formatDate(user.created_at)}</div>
            </div>

            <div className="col-span-2">
                <Chip
                    size="sm"
                    variant="flat"
                    className={
                        user.access_status === "rejected"
                            ? "bg-red-500/20 border border-red-500/40 text-red-400 font-semibold"
                            : user.access_status === "pending"
                                ? "bg-blue-500/20 border border-blue-500/40 text-blue-300 font-semibold"
                            : user.is_admin
                                ? "bg-[#CFB87C]/20 border border-[#CFB87C]/30 text-[#CFB87C] font-semibold"
                                : "bg-white/10 border border-white/20 text-white font-semibold"
                    }
                >
                    {user.is_admin ? "Admin" : "User"}
                </Chip>
            </div>

            <div className="col-span-2 text-sm text-white/70">
                Plan {user.plan ?? 0}
            </div>

            <div className="col-span-2 text-sm text-white/70">
                Usage {user.monthly_usage_count ?? 0}
            </div>

            <div className="col-span-1 flex justify-end">
                <button
                    className={GOLD_BUTTON_SM}
                    onClick={() => openDelete(user)}
                >
                    Delete
                </button>
            </div>
        </div>
    ));

    async function handleApproveAccessRequest(userId) {
        setAccessActionBusyUserId(userId);
        try {
            await adminService.approveAccessRequest(userId);
            await Promise.all([loadAccessRequests(accessPage), loadUsers(page)]);
        } catch (err) {
            setAccessError(err?.message || "Failed to approve access request");
        } finally {
            setAccessActionBusyUserId("");
        }
    }

    async function handleRejectAccessRequest(userId) {
        setAccessActionBusyUserId(userId);
        try {
            await adminService.rejectAccessRequest(userId);
            await Promise.all([loadAccessRequests(accessPage), loadUsers(page)]);
        } catch (err) {
            setAccessError(err?.message || "Failed to reject access request");
        } finally {
            setAccessActionBusyUserId("");
        }
    }

    return (
        <div className="flex flex-col gap-6 h-full overflow-y-scroll px-4 md:px-8 pb-10 bg-[#0f0f0f] text-white [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex flex-col items-center gap-4 pt-4 text-center">
                <div className="w-full flex items-center justify-between gap-4">
                    <h2 className="text-2xl font-black tracking-tight text-[#CFB87C]">User Management</h2>
                    <div className="flex bg-black/40 p-1 rounded-2xl border border-white/10">
                        <button
                            type="button"
                            onClick={() => setActiveTab("users")}
                            className={`h-9 px-4 rounded-xl font-black uppercase tracking-wide text-xs transition-all ${
                                activeTab === "users"
                                    ? "bg-[#CFB87C] text-[#111]"
                                    : "text-white/70 hover:text-white"
                            }`}
                        >
                            Users
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setActiveTab("deleted");
                                loadLogs(1);
                            }}
                            className={`h-9 px-4 rounded-xl font-black uppercase tracking-wide text-xs transition-all ${
                                activeTab === "deleted"
                                    ? "bg-[#CFB87C] text-[#111]"
                                    : "text-white/70 hover:text-white"
                            }`}
                        >
                            Deleted Users
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setActiveTab("access-requests");
                                loadAccessRequests(1);
                            }}
                            className={`h-9 px-4 rounded-xl font-black uppercase tracking-wide text-xs transition-all ${
                                activeTab === "access-requests"
                                    ? "bg-[#CFB87C] text-[#111]"
                                    : "text-white/70 hover:text-white"
                            }`}
                        >
                            Access Requests
                        </button>
                    </div>
                </div>

                {activeTab === "users" && (
                    <div className="flex flex-wrap gap-2 w-full justify-center items-center">
                        <Input
                            placeholder="Search name or email"
                            size="sm"
                            className="w-full md:w-72"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            variant="flat"
                            color="default"
                            classNames={{
                                inputWrapper: "h-9 min-h-9 bg-[#0b0b0b] border border-white/20 shadow-sm data-[hover=true]:border-white/30 group-data-[focus=true]:border-[#CFB87C] group-data-[focus=true]:shadow-none group-data-[focus-visible=true]:ring-0 group-data-[focus-visible=true]:outline-none group-data-[focus=true]:ring-0 group-data-[focus=true]:outline-none",
                                input: "text-white placeholder:text-white/45 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0",
                            }}
                        />
                        <Select
                            size="sm"
                            className="w-[180px]"
                            selectedKeys={new Set([sort])}
                            onSelectionChange={(selection) => {
                                setSort(getSelectedKey(selection, "created_at_desc"));
                            }}
                            aria-label="Sort users"
                            variant="flat"
                            classNames={SELECT_DROPDOWN_CLASSES}
                            listboxProps={{
                                itemClasses: {
                                    base: "text-white data-[hover=true]:bg-white/10 data-[selectable=true]:focus:bg-white/10 data-[selected=true]:bg-[#CFB87C]/20",
                                },
                            }}
                        >
                            <SelectItem key="created_at_desc">
                                Newest first
                            </SelectItem>
                            <SelectItem key="created_at_asc">
                                Oldest first
                            </SelectItem>
                            <SelectItem key="user_name_asc">
                                Name A → Z
                            </SelectItem>
                            <SelectItem key="user_name_desc">
                                Name Z → A
                            </SelectItem>
                        </Select>

                        <Select
                            size="sm"
                            className="w-[180px]"
                            selectedKeys={new Set([accessStatusFilter])}
                            onSelectionChange={(selection) => {
                                setAccessStatusFilter(getSelectedKey(selection, "all"));
                            }}
                            aria-label="Filter by access status"
                            variant="flat"
                            classNames={SELECT_DROPDOWN_CLASSES}
                            listboxProps={{
                                itemClasses: {
                                    base: "text-white data-[hover=true]:bg-white/10 data-[selectable=true]:focus:bg-white/10 data-[selected=true]:bg-[#CFB87C]/20",
                                },
                            }}
                        >
                            <SelectItem key="all">
                                All statuses
                            </SelectItem>
                            <SelectItem key="approved">
                                Approved
                            </SelectItem>
                            <SelectItem key="pending">
                                Pending
                            </SelectItem>
                            <SelectItem key="rejected">
                                Rejected
                            </SelectItem>
                            <SelectItem key="admin">
                                Admin
                            </SelectItem>
                        </Select>

                        <Button
                            size="sm"
                            className={GOLD_BUTTON_SM}
                            onPress={() => {
                                setCreateError("");
                                setCreateModalOpen(true);
                            }}
                        >
                            Add User
                        </Button>
                    </div>
                )}
            </div>

            {error && <div className="text-sm text-red-400">{error}</div>}
            {accessError && activeTab === "access-requests" && <div className="text-sm text-red-400">{accessError}</div>}

            {activeTab === "users" && (
                <Card className="border border-white/5 bg-[#111] shadow-xl overflow-visible" radius="lg">
                    <CardBody className="p-0">
                        <div className="grid grid-cols-12 gap-4 p-4 border-b border-white/10 bg-[#161616] text-[11px] font-black uppercase tracking-[0.08em] text-white/60">
                            <div className="col-span-5">User</div>
                            <div className="col-span-2">Role</div>
                            <div className="col-span-2">Plan</div>
                            <div className="col-span-2">Usage</div>
                            <div className="col-span-1 text-right">Actions</div>
                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center py-10">
                                <Spinner size="sm" color="warning" />
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5">{rows}</div>
                        )}
                    </CardBody>

                    <div className="p-4 border-t border-white/10 flex items-center justify-between text-sm text-white/70">
                        <span>
                            Page {page} of {totalPages} · {total} users
                        </span>
                        <div className="flex gap-2">
                            <Button size="sm" className={GOLD_BUTTON_SM} isDisabled={page === 1} onPress={() => loadUsers(page - 1)}>
                                Previous
                            </Button>
                            <Button size="sm" className={GOLD_BUTTON_SM} isDisabled={page >= totalPages} onPress={() => loadUsers(page + 1)}>
                                Next
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {activeTab === "deleted" && (
                <Card className="border border-white/5 bg-[#111] shadow-xl overflow-visible" radius="lg">
                    <CardBody className="p-0">
                        <div className="grid grid-cols-12 gap-4 p-4 border-b border-white/10 bg-[#161616] text-[11px] font-black uppercase tracking-[0.08em] text-white/60">
                            <div className="col-span-4">Deleted User</div>
                            <div className="col-span-3">Deleted By</div>
                            <div className="col-span-2">Reason</div>
                            <div className="col-span-2">Deleted At</div>
                            <div className="col-span-1 text-right">Details</div>
                        </div>

                        {loadingLogs ? (
                            <div className="flex items-center justify-center py-10">
                                <Spinner size="sm" color="warning" />
                            </div>
                        ) : auditLogs.length === 0 ? (
                            <div className="p-4 text-sm text-white/60">No deleted users found.</div>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {auditLogs.map((log) => (
                                    <div key={log.log_id} className="p-3">
                                        <div className="grid grid-cols-12 gap-4 items-center">
                                            <div className="col-span-4">
                                                <div className="text-sm font-semibold text-white leading-tight">{log.deleted_user_name || "-"}</div>
                                                <div className="text-xs text-white/60 leading-tight">{log.deleted_user_email || log.deleted_user_id}</div>
                                            </div>
                                            <div className="col-span-3 text-sm text-white/80">{log.deleted_by_email || log.deleted_by_user_id}</div>
                                            <div className="col-span-2 text-sm text-white/80">{log.reason_code}</div>
                                            <div className="col-span-2 text-sm text-white/70">{formatDate(log.deleted_at)}</div>
                                            <div className="col-span-1 text-right">
                                                <details className="text-xs text-white/70 inline-block text-left">
                                                    <summary className="cursor-pointer font-semibold text-white/80 list-none">View</summary>
                                                    <pre className="mt-2 w-[420px] max-w-[70vw] bg-[#0f0f0f] border border-white/10 rounded p-2 overflow-auto text-[11px] leading-tight text-white/80">
                                                        {JSON.stringify(log.user_snapshot, null, 2)}
                                                    </pre>
                                                </details>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardBody>

                    <div className="p-4 border-t border-white/10 flex items-center justify-between text-sm text-white/70">
                        <span>Page {logPage}</span>
                        <div className="flex gap-2">
                            <Button size="sm" className={GOLD_BUTTON_SM} isDisabled={loadingLogs || logPage === 1} onPress={() => loadLogs(logPage - 1)}>
                                Previous
                            </Button>
                            <Button size="sm" className={GOLD_BUTTON_SM} isDisabled={loadingLogs || !logsHasMore} onPress={() => loadLogs(logPage + 1)}>
                                Next
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {activeTab === "access-requests" && (
                <Card className="border border-white/5 bg-[#111] shadow-xl overflow-visible" radius="lg">
                    {accessRequests.length > 0 && (
                        <div className="flex flex-wrap gap-2 px-4 pt-4">
                            {Object.entries(
                                accessRequests.reduce((acc, u) => {
                                    const key = u.how_did_you_find_us || "other";
                                    acc[key] = (acc[key] || 0) + 1;
                                    return acc;
                                }, {})
                            ).sort((a, b) => b[1] - a[1]).map(([key, count]) => (
                                <span key={key} className="text-xs px-3 py-1 rounded-full bg-white/10 border border-white/15 text-white/70 font-semibold">
                                    {FOUND_US_LABELS[key] ?? key} · <span className="text-white">{count}</span>
                                </span>
                            ))}
                        </div>
                    )}
                    <CardBody className="p-0">
                        <div className="grid grid-cols-12 gap-4 p-4 border-b border-white/10 bg-[#161616] text-[11px] font-black uppercase tracking-[0.08em] text-white/60">
                            <div className="col-span-4">Applicant</div>
                            <div className="col-span-3">Found Us Via</div>
                            <div className="col-span-3">Requested At</div>
                            <div className="col-span-2 text-right">Actions</div>
                        </div>

                        {accessLoading ? (
                            <div className="flex items-center justify-center py-10">
                                <Spinner size="sm" color="warning" />
                            </div>
                        ) : accessRequests.length === 0 ? (
                            <div className="p-4 text-sm text-white/60">No pending access requests.</div>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {accessRequests.map((user) => {
                                    const isBusy = accessActionBusyUserId === user.user_id;
                                    return (
                                        <div key={user.user_id} className="grid grid-cols-12 gap-4 p-3 items-center hover:bg-white/5 transition-colors">
                                            <div className="col-span-4">
                                                <div className="text-sm font-semibold text-white leading-tight">{user.user_name}</div>
                                                <div className="text-xs text-white/60 leading-tight">{user.email}</div>
                                            </div>
                                            <div className="col-span-3 text-sm text-white/70">{FOUND_US_LABELS[user.how_did_you_find_us] ?? user.how_did_you_find_us ?? "-"}</div>
                                            <div className="col-span-3 text-sm text-white/70">{formatDate(user.created_at)}</div>
                                            <div className="col-span-2 flex justify-end gap-2">
                                                <button
                                                    className={GOLD_BUTTON_SM}
                                                    disabled={isBusy}
                                                    onClick={() => handleApproveAccessRequest(user.user_id)}
                                                >
                                                    Approve
                                                </button>
                                                <button
                                                    className={GOLD_BUTTON_SM}
                                                    disabled={isBusy}
                                                    onClick={() => handleRejectAccessRequest(user.user_id)}
                                                >
                                                    Reject
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardBody>

                    <div className="p-4 border-t border-white/10 flex items-center justify-between text-sm text-white/70">
                        <span>
                            Page {accessPage} of {accessTotalPages} · {accessTotal} requests
                        </span>
                        <div className="flex gap-2">
                            <Button size="sm" className={GOLD_BUTTON_SM} isDisabled={accessPage === 1 || accessLoading} onPress={() => loadAccessRequests(accessPage - 1)}>
                                Previous
                            </Button>
                            <Button size="sm" className={GOLD_BUTTON_SM} isDisabled={accessPage >= accessTotalPages || accessLoading} onPress={() => loadAccessRequests(accessPage + 1)}>
                                Next
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            <Modal
                isOpen={createModalOpen}
                onOpenChange={(open) => { setCreateModalOpen(open); if (!open) resetCreateState(); }}
                placement="center"
                size="md"
                backdrop="blur"
                hideCloseButton
                classNames={{ base: "bg-transparent", wrapper: "backdrop-blur" }}
            >
                <ModalContent className="relative bg-[#111] border border-white/10 shadow-2xl text-white rounded-3xl w-[75vw] max-w-3xl mx-auto">
                    {() => (
                        <>
                            <button
                                aria-label="Close"
                                className="absolute top-4 right-4 text-[#CFB87C] hover:brightness-110 text-xl leading-none font-black"
                                onClick={() => { setCreateModalOpen(false); resetCreateState(); }}
                            >
                                ×
                            </button>
                            <ModalHeader className="flex flex-col gap-2 text-white pr-6">
                                <div className="text-sm uppercase tracking-[0.18em] text-white/50 font-black">New user</div>
                                <div className="text-2xl font-black text-[#CFB87C]">Create account</div>
                            </ModalHeader>
                            <ModalBody className="space-y-5 px-6 pb-2">
                                <div className="flex bg-black/40 border border-white/10 rounded-2xl p-1 shadow-inner">
                                    <Button
                                        size="sm"
                                        variant="light"
                                        color="default"
                                        className={`flex-1 ${createMode === "manual" ? GOLD_BUTTON_MD : BUTTON_INACTIVE}`}
                                        onPress={() => setCreateMode("manual")}
                                    >
                                        Manual
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="light"
                                        color="default"
                                        className={`flex-1 ${createMode === "auto" ? GOLD_BUTTON_MD : BUTTON_INACTIVE}`}
                                        onPress={() => setCreateMode("auto")}
                                    >
                                        Automatic
                                    </Button>
                                </div>

                                {createMode === "manual" ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-black uppercase tracking-wide text-white/50 mb-2">Name</label>
                                            <Input
                                                value={manualForm.user_name}
                                                onChange={(e) => handleManualChange("user_name", e.target.value)}
                                                placeholder="Jane Doe"
                                                isRequired
                                                variant="bordered"
                                                classNames={{
                                                    inputWrapper: "bg-black/40 border-white/10",
                                                    input: "text-white",
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-black uppercase tracking-wide text-white/50 mb-2">Email</label>
                                            <Input
                                                type="email"
                                                value={manualForm.email}
                                                onChange={(e) => handleManualChange("email", e.target.value)}
                                                placeholder="jane@example.com"
                                                isRequired
                                                variant="bordered"
                                                classNames={{
                                                    inputWrapper: "bg-black/40 border-white/10",
                                                    input: "text-white",
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-black uppercase tracking-wide text-white/50 mb-2">Password</label>
                                            <Input
                                                type="password"
                                                value={manualForm.password}
                                                onChange={(e) => handleManualChange("password", e.target.value)}
                                                placeholder="Leave blank to auto-generate"
                                                variant="bordered"
                                                classNames={{
                                                    inputWrapper: "bg-black/40 border-white/10",
                                                    input: "text-white",
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-black uppercase tracking-wide text-white/50 mb-2">Date of birth</label>
                                            <Input
                                                type="text"
                                                inputMode="numeric"
                                                pattern="\\d{2}-\\d{2}-\\d{4}"
                                                value={manualForm.date_of_birth}
                                                onChange={(e) => {
                                                    const digits = String(e.target.value || "").replace(/\D/g, "").slice(0, 8);
                                                    const parts = [];
                                                    if (digits.length > 0) parts.push(digits.slice(0, Math.min(2, digits.length)));
                                                    if (digits.length > 2) parts.push(digits.slice(2, Math.min(4, digits.length)));
                                                    if (digits.length > 4) parts.push(digits.slice(4, 8));
                                                    handleManualChange("date_of_birth", parts.join("-"));
                                                }}
                                                placeholder="DD-MM-YYYY"
                                                isRequired
                                                variant="bordered"
                                                classNames={{
                                                    inputWrapper: "bg-black/40 border-white/10",
                                                    input: "text-white",
                                                }}
                                            />
                                        </div>
                                        <div className="md:col-span-2 flex justify-center">
                                            <div className="w-full max-w-sm rounded-xl border border-white/10 bg-black/40 p-3">
                                                <div className="text-xs font-black uppercase tracking-wide text-white/70 mb-2 text-center">
                                                    Password requirements
                                                </div>
                                                <div className="space-y-1">
                                                    {PASSWORD_POLICY_RULES.map((rule) => {
                                                        const ok = hasTypedPassword ? Boolean(passwordChecks[rule.id]) : false;
                                                        return (
                                                            <div
                                                                key={rule.id}
                                                                className={`text-xs flex items-center gap-1 ${ok ? "text-emerald-300" : "text-white/60"}`}
                                                            >
                                                                <span className="inline-block w-4 text-center">
                                                                    {ok ? "✓" : "○"}
                                                                </span>
                                                                {rule.text}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="text-sm text-white/70">Automatic mode generates randomized details. Role is fixed to User.</div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                            <div className="p-3 rounded-xl bg-black/40 border border-white/10">
                                                <div className="text-xs text-white/50 uppercase">Name</div>
                                                <div className="font-semibold">{autoUser.user_name}</div>
                                            </div>
                                            <div className="p-3 rounded-xl bg-black/40 border border-white/10">
                                                <div className="text-xs text-white/50 uppercase">Email</div>
                                                <div className="font-semibold">{autoUser.email}</div>
                                            </div>
                                            <div className="p-3 rounded-xl bg-black/40 border border-white/10 md:col-span-2">
                                                <div className="text-xs text-white/50 uppercase">Password</div>
                                                <div className="font-mono text-xs break-all">{autoUser.password}</div>
                                            </div>
                                            <div className="p-3 rounded-xl bg-black/40 border border-white/10 md:col-span-2">
                                                <div className="text-xs text-white/50 uppercase">Date of birth</div>
                                                <div className="font-semibold">{autoUser.date_of_birth}</div>
                                            </div>
                                        </div>
                                        <Button className={GOLD_BUTTON_SM} onPress={() => setAutoUser(generateAutoUser())}>Regenerate</Button>
                                    </div>
                                )}

                                {createError && (
                                    <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                                        {createError}
                                    </div>
                                )}

                                {createResult && (
                                    <div className="bg-green-500/10 border border-green-400/30 rounded-lg p-3 text-sm text-green-100">
                                        <div className="font-semibold text-green-200">User created</div>
                                        <div>Email: {createResult.user?.email}</div>
                                    </div>
                                )}
                            </ModalBody>
                            <ModalFooter className="border-t border-white/10 px-6 pb-6">
                                <Button className={GOLD_BUTTON_SM} onPress={() => { setCreateModalOpen(false); resetCreateState(); }}>
                                    Close
                                </Button>
                                <Button onPress={handleCreateUser} isLoading={creating} className={GOLD_BUTTON_SM}>
                                    Create
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>

            <Modal
                isOpen={deleteModalOpen}
                onOpenChange={setDeleteModalOpen}
                placement="center"
                size="md"
                backdrop="blur"
                hideCloseButton
                classNames={{ base: "bg-transparent", wrapper: "backdrop-blur" }}
            >
                <ModalContent className="relative bg-[#111] border border-white/10 shadow-2xl text-white rounded-3xl w-[70vw] max-w-2xl mx-auto">
                    {() => (
                        <>
                            <button
                                aria-label="Close"
                                className="absolute top-4 right-4 text-[#CFB87C] hover:brightness-110 text-xl leading-none font-black"
                                onClick={() => setDeleteModalOpen(false)}
                            >
                                ×
                            </button>
                            <ModalHeader className="flex flex-col gap-2 text-white pr-8">
                                <div className="text-sm uppercase tracking-[0.18em] text-white/50 font-black">Delete user</div>
                                <div className="text-2xl font-black text-red-300">Confirm deletion</div>
                            </ModalHeader>
                            <ModalBody className="space-y-4 px-6 pb-2">
                                <p className="text-sm text-white/75 leading-relaxed">
                                    You are about to delete {targetUser?.user_name || targetUser?.email}. This cannot be undone.
                                    Please provide a reason (required for audit logging).
                                </p>

                                <div>
                                    <label className="block text-xs font-black uppercase tracking-wide text-white/50 mb-2">Reason</label>
                                    <Select
                                        selectedKeys={new Set([deleteReason])}
                                        onSelectionChange={(selection) => {
                                            setDeleteReason(getSelectedKey(selection, "test_purpose"));
                                        }}
                                        variant="bordered"
                                        classNames={SELECT_DROPDOWN_CLASSES}
                                    >
                                        {DELETE_REASON_OPTIONS.map((opt) => (
                                            <SelectItem
                                                key={opt.key}
                                                className="text-white data-[hover=true]:bg-white/10 data-[selectable=true]:focus:bg-white/10 data-[selected=true]:bg-[#CFB87C]/20"
                                            >
                                                {opt.label}
                                            </SelectItem>
                                        ))}
                                    </Select>
                                </div>

                                <div>
                                    <label className="block text-xs font-black uppercase tracking-wide text-white/50 mb-2">
                                        {deleteReason === "other" ? "Reason details (required)" : "Additional context"}
                                    </label>
                                    <Textarea
                                        minRows={3}
                                        disableAutosize
                                        value={deleteDetail}
                                        onChange={(e) => setDeleteDetail(e.target.value)}
                                        isRequired={deleteReason === "other"}
                                        placeholder="Add details for audit history"
                                        variant="bordered"
                                        className="w-full"
                                        classNames={{
                                            base: "w-full",
                                            inputWrapper:
                                                "min-h-[96px] bg-black border border-white/10 rounded-md shadow-none " +
                                                "data-[hover=true]:border-white/20 group-data-[focus=true]:border-[#CFB87C] " +
                                                "group-data-[focus=true]:shadow-none",
                                            input:
                                                "text-white placeholder:text-white/40 resize-none !bg-transparent " +
                                                "focus:outline-none",
                                        }}
                                    />
                                </div>

                                {deleteError && (
                                    <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                                        {deleteError}
                                    </div>
                                )}
                            </ModalBody>
                            <ModalFooter className="border-t border-white/10 px-6 pb-6">
                                <Button className={GOLD_BUTTON_SM} onPress={() => setDeleteModalOpen(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    onPress={handleDeleteUser}
                                    isLoading={deleting}
                                    isDisabled={deleteReason === "other" && !deleteDetail.trim()}
                                    className={GOLD_BUTTON_SM}
                                >
                                    Delete user
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>
        </div>
    );
}