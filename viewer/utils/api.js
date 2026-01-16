export const API_URL = 'http://localhost:3030';
export async function fetchTasks(filter = 'active') {
    let url = `${API_URL}/tasks`;
    if (filter === 'active') {
        url += '?status=open,in_progress,blocked';
    }
    else if (filter === 'done') {
        url += '?status=done,cancelled&limit=20';
    }
    else if (filter === 'all') {
        url += '?status=open,in_progress,blocked,done,cancelled&limit=20';
    }
    const response = await fetch(url);
    return response.json();
}
export async function fetchTask(taskId) {
    const response = await fetch(`${API_URL}/tasks/${taskId}`);
    return response.json();
}
