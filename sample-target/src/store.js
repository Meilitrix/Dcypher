// In-memory task store for the Tiny Inbox sample target.
// This is the data model the rest of the app reads from and writes to.

let idCounter = 3;

const tasks = [
  { id: 1, title: 'Review pull request #482', done: false },
  { id: 2, title: 'Write release notes', done: true },
];

export function listTasks() {
  return tasks.slice();
}

export function getTask(id) {
  return tasks.find((task) => task.id === Number(id)) ?? null;
}

export function addTask(title) {
  const task = { id: idCounter++, title, done: false };
  tasks.push(task);
  return task;
}

export function toggleTask(id) {
  const task = getTask(id);
  if (task) task.done = !task.done;
  return task;
}
