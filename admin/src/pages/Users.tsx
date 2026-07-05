import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import type { AdminUser, Role } from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import { useToast } from '../components/Toast';

const fullName = (u: AdminUser) => `${u.firstName} ${u.lastName}`.trim();

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<AdminUser[]>('/api/admin/users')
      .then((data) => live && setUsers(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  const changeRole = async (user: AdminUser, role: Role) => {
    const previous = users;
    setUsers((cur) => (cur ? cur.map((u) => (u.id === user.id ? { ...u, role } : u)) : cur));
    try {
      const updated = await api<AdminUser>(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: { role },
      });
      setUsers((cur) => (cur ? cur.map((u) => (u.id === user.id ? updated : u)) : cur));
      toast(`${user.email} is now ${role === 'admin' ? 'an admin' : 'a customer'}`);
    } catch (err) {
      setUsers(previous ?? null);
      toast(err instanceof Error ? err.message : 'Unable to update role');
    }
  };

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (u) =>
        fullName(u) ? <span className="nm">{fullName(u)}</span> : <span className="dim">—</span>,
    },
    { key: 'email', label: 'Email', render: (u) => u.email },
    {
      key: 'provider',
      label: 'Provider',
      render: (u) => <span className="badge muted">{u.authProvider}</span>,
    },
    {
      key: 'role',
      label: 'Role',
      render: (u) =>
        u.role === 'admin' ? (
          <span className="badge crafting">Admin</span>
        ) : (
          <span className="badge pending">Customer</span>
        ),
    },
    { key: 'orders', label: 'Orders', align: 'right', render: (u) => u.ordersCount },
    { key: 'joined', label: 'Joined', render: (u) => formatDate(u.createdAt) },
    {
      key: 'action',
      label: 'Access',
      render: (u) => {
        const self = me?.id === u.id;
        const next: Role = u.role === 'admin' ? 'customer' : 'admin';
        return (
          <button
            type="button"
            className="ulink"
            disabled={self}
            title={self ? 'You cannot change your own role' : undefined}
            onClick={() => void changeRole(u, next)}
          >
            {next === 'admin' ? 'Make admin' : 'Make customer'}
          </button>
        );
      },
    },
  ];

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The House · Access</span>
        <h1>Users</h1>
      </div>

      {error && <p className="state-note">{error}</p>}
      {!users && !error && <p className="state-note">Loading users…</p>}
      {users && (
        <DataTable
          columns={columns}
          rows={users}
          rowKey={(u) => u.id}
          empty="No users registered yet."
        />
      )}
    </>
  );
}
