import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import {
  useAddMember,
  useAppState,
  useMembers,
  useRemoveMember,
  useUpdateMember,
} from "../api/hooks";
import type { Member } from "../api/types";

export const Route = createFileRoute("/members")({ component: MembersView });

function MembersView() {
  const { data: state } = useAppState();
  const { data: members, isLoading, error } = useMembers();
  const isOwner = state?.currentUser.role === "owner";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-slate-800">メンバー</h1>
      {!isOwner && (
        <p className="mt-1 text-xs text-slate-400">
          閲覧のみ。追加・変更・削除は owner のみ可能です。
        </p>
      )}

      {isOwner && <AddMemberForm />}

      {isLoading && <p className="mt-4 text-sm text-slate-400">読み込み中…</p>}
      {error && (
        <p className="mt-4 text-sm text-red-600">
          {error instanceof Error ? error.message : "読み込みに失敗しました"}
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {(members ?? []).map((m) => (
          <MemberRow
            key={m.email}
            member={m}
            isOwner={isOwner}
            isSelf={m.email === state?.currentUser.email}
          />
        ))}
        {members?.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-slate-400">メンバーがいません。</p>
        )}
      </div>
    </div>
  );
}

function AddMemberForm() {
  const add = useAddMember();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"member" | "owner">("member");

  const submit = () => {
    if (!email.trim() || !displayName.trim()) return;
    add.mutate(
      { email: email.trim(), displayName: displayName.trim(), role },
      {
        onSuccess: () => {
          setEmail("");
          setDisplayName("");
          setRole("member");
        },
      },
    );
  };

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-sm font-semibold text-slate-700">メンバーを追加</div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className="block text-xs text-slate-500">メールアドレス</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
        <div className="min-w-[140px] flex-1">
          <label className="block text-xs text-slate-500">表示名</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="山田 太郎"
            className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500">権限</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "owner")}
            className="mt-1 rounded border border-slate-200 px-2.5 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
          >
            <option value="member">member</option>
            <option value="owner">owner</option>
          </select>
        </div>
        <button
          onClick={submit}
          disabled={!email.trim() || !displayName.trim() || add.isPending}
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {add.isPending ? "追加中…" : "追加"}
        </button>
      </div>
      {add.error && (
        <p className="mt-2 text-xs text-red-600">
          {add.error instanceof ApiError ? add.error.message : "追加に失敗しました"}
        </p>
      )}
    </div>
  );
}

function MemberRow({
  member,
  isOwner,
  isSelf,
}: {
  member: Member;
  isOwner: boolean;
  isSelf: boolean;
}) {
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const err = update.error ?? remove.error;

  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-800">
          {member.displayName}
          {isSelf && <span className="ml-2 text-xs text-slate-400">(自分)</span>}
        </div>
        <div className="truncate text-xs text-slate-400">{member.email}</div>
        {err && (
          <div className="text-xs text-red-600">
            {err instanceof ApiError ? err.message : "操作に失敗しました"}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isOwner ? (
          <select
            value={member.role}
            disabled={update.isPending}
            onChange={(e) =>
              update.mutate({ email: member.email, role: e.target.value as "owner" | "member" })
            }
            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 focus:border-slate-400 focus:outline-none"
          >
            <option value="member">member</option>
            <option value="owner">owner</option>
          </select>
        ) : (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {member.role}
          </span>
        )}

        {isOwner && (
          <button
            onClick={() => {
              if (confirm(`${member.displayName} を削除しますか？`)) remove.mutate(member.email);
            }}
            disabled={remove.isPending}
            className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-40"
          >
            削除
          </button>
        )}
      </div>
    </div>
  );
}
