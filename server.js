const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// API ดึงค่าสถิติทั้งหมด (เริ่มต้นเป็น 0 เมื่อยังไม่มีข้อมูลในตาราง)
app.get('/api/dashboard', async (req, res) => {
  const { data: members } = await supabase.from('members').select('*');
  const { data: products } = await supabase.from('products').select('*').eq('is_sold', false);
  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  res.json({
    totalUsers: members?.length || 0,
    approvedAff: members?.filter(m => m.affiliate_status === 'approved').length || 0,
    pendingAff: members?.filter(m => m.affiliate_status === 'pending').length || 0,
    products: products || [],
    transactions: transactions || []
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));