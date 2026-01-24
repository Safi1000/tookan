
// DELETE Task (and connected task)
app.post('/api/tookan/delete-task', authenticate, requirePermission('perform_reorder'), async (req, res) => {
    try {
        console.log('\n=== DELETE TASK REQUEST ===');
        const { jobId } = req.body;

        if (!jobId) {
            return res.status(400).json({ status: 'error', message: 'Job ID is required' });
        }

        // 1. Fetch task details from DB to find connected task
        const { data: task, error: fetchError } = await supabase
            .from('tasks')
            .select('job_id, raw_data')
            .eq('job_id', jobId)
            .single();

        if (fetchError || !task) {
            console.error('Failed to find task in DB:', jobId);
            return res.status(404).json({ status: 'error', message: 'Task not found in database' });
        }

        // 2. Identify connected task
        // Try to find connected task ID from raw_data or relationship logic
        // Usually mapped in raw_data.pickup_delivery_relationship or by matching tracking link etc.
        // For now, we will query the DB for the OTHER task that shares the same order_id or tracking link if possible.
        // BETTER STRATEGY: Use the 'order_id' or 'pickup_delivery_relationship' field if available.
        // Let's assume the user wants to delete the "Job" they clicked, AND if it's part of a P/D pair, the other one.

        // In Tookan, pickup_delivery_relationship is often a unique string shared by both.
        const relationshipId = task.raw_data?.pickup_delivery_relationship;
        let connectedJobIds = [jobId];

        if (relationshipId) {
            // Find all tasks with this relationship ID
            const { data: relatedTasks } = await supabase
                .from('tasks')
                .select('job_id')
                .eq('raw_data->>pickup_delivery_relationship', relationshipId);

            if (relatedTasks) {
                connectedJobIds = relatedTasks.map(t => t.job_id);
            }
        }

        // Ensure we have unique IDs (in case logic adds duplicates)
        connectedJobIds = [...new Set(connectedJobIds)];
        console.log(`🗑️ Deleting tasks: ${connectedJobIds.join(', ')}`);

        const apiKey = getApiKey();
        const results = [];

        // 3. Delete from Tookan (Loop through IDs)
        for (const id of connectedJobIds) {
            const response = await fetch('https://api.tookanapp.com/v2/delete_task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: apiKey, job_id: String(id) })
            });
            const data = await response.json();
            results.push({ id, status: data.status, message: data.message });
        }

        // 4. Delete from Supabase
        const { error: deleteError } = await supabase
            .from('tasks')
            .delete()
            .in('job_id', connectedJobIds);

        if (deleteError) {
            console.error('Failed to delete from Supabase:', deleteError);
        }

        console.log('✅ Delete operation completed');
        console.log('=== END REQUEST (SUCCESS) ===\n');

        res.json({
            status: 'success',
            message: 'Tasks deleted successfully',
            data: { deletedIds: connectedJobIds, results }
        });

    } catch (error) {
        console.error('❌ Delete task error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});
