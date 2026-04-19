"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getTasks, updateTask, deleteTask, Task } from "@/lib/api";

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "done">("open");

  useEffect(() => {
    fetchTasks();
  }, [filter]);

  async function fetchTasks() {
    setLoading(true);
    try {
      const data = await getTasks(filter === "all" ? undefined : filter);
      setTasks(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus(task: Task) {
    const newStatus = task.status === "open" ? "done" : "open";
    try {
      await updateTask(task.id, { status: newStatus });
      fetchTasks();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      await deleteTask(id);
      fetchTasks();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Task List</h1>
        <div className="flex bg-gray-100 p-1 rounded-lg">
          {(["all", "open", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                filter === f
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="py-12 text-center bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-500 text-sm">No tasks found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 shadow-sm">
          {tasks.map((task) => (
            <div key={task.id} className="p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
              <button
                onClick={() => toggleStatus(task)}
                className={`mt-1 h-5 w-5 rounded border flex items-center justify-center transition-colors ${
                  task.status === "done"
                    ? "bg-green-500 border-green-500 text-white"
                    : "bg-white border-gray-300 hover:border-gray-400"
                }`}
              >
                {task.status === "done" && (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`font-medium ${task.status === "done" ? "text-gray-400 line-through" : "text-gray-900"}`}>
                  {task.title}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  {task.due_date && (
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {new Date(task.due_date).toLocaleDateString()}
                    </span>
                  )}
                  {task.email_id && (
                    <Link
                      href={`/email/${task.email_id}`}
                      className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      View Email
                    </Link>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(task.id)}
                className="text-gray-400 hover:text-red-500 transition-colors"
                title="Delete task"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
