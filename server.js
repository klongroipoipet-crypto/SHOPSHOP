const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ดึงข้อมูลแดชบอร์ดและรายการทั้งหมด
app.get('/api/dashboard', async (req, res) => {
  const { data: members } = await supabase.from('members').select('*');
  const { data: products } = await supabase.from('products').select('*');
  const { data: transactions } = await supabase.from('transactions').select('*').order('created_at', { ascending: false });
  const { data: financeRequests } = await supabase.from('finance_requests').select('*').order('created_at', { ascending: false });
  const { data: orders } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
  const { data: settings } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();

  res.json({
    members: members || [],
    products: products || [],
    transactions: transactions || [],
    financeRequests: financeRequests || [],
    orders: orders || [],
    settings: settings || { bank_info: 'ยังไม่ได้ตั้งค่าบัญชี', admin_pin: '1688' }
  });
});

// สมัครสมาชิก
app.post('/api/register', async (req, res) => {
  const { phone, password, bank, role } = req.body;
  const status = role === 'affiliate' ? 'pending' : 'member';
  const { data, error } = await supabase
    .from('members')
    .insert([{ phone, password, bank, role, status, balance: 0, comm_balance: 0 }])
    .select();
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, user: data[0] });
});

// เพิ่มสินค้า
app.post('/api/products', async (req, res) => {
  const { name, size_detail, condition_grade, price, commission, image_url } = req.body;
  const { data, error } = await supabase
    .from('products')
    .insert([{ name, size_detail, condition_grade, price, commission, image_url, is_sold: false }])
    .select();
  
  if (error) return res.status(400).json({ error: error.message });
  res.json(data[0]);
});

// ลบสินค้า
app.delete('/api/products/:id', async (req, res) => {
  await supabase.from('products').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ส่งคำขอฝาก/ถอนเงิน
app.post('/api/finance-request', async (req, res) => {
  const { reqType, phone, amount, slip, bank, source } = req.body;
  const { data, error } = await supabase
    .from('finance_requests')
    .insert([{ req_type: reqType, phone, amount, slip, bank, source, status: 'รอตรวจสอบ' }])
    .select();
  
  if (error) return res.status(400).json({ error: error.message });
  res.json(data[0]);
});

// อนุมัติรายการฝาก/ถอนเงิน
app.post('/api/approve-finance', async (req, res) => {
  const { requestId } = req.body;
  const { data: reqData } = await supabase.from('finance_requests').select('*').eq('id', requestId).single();
  if (!reqData || reqData.status === 'สำเร็จ') return res.status(400).json({ error: 'Invalid request' });

  const { data: member } = await supabase.from('members').select('*').eq('phone', reqData.phone).single();

  if (reqData.req_type === 'deposit') {
    await supabase.from('members').update({ balance: member.balance + Number(reqData.amount) }).eq('phone', reqData.phone);
    await supabase.from('transactions').insert([{ type: 'ฝากเงินเข้ากระเป๋า', phone: reqData.phone, amount: reqData.amount, sign: '+', status: 'สำเร็จ' }]);
  } else {
    await supabase.from('transactions').insert([{ type: 'ถอนเงินสำเร็จ', phone: reqData.phone, amount: reqData.amount, sign: '-', status: 'สำเร็จ' }]);
  }

  await supabase.from('finance_requests').update({ status: 'สำเร็จ' }).eq('id', requestId);
  res.json({ success: true });
});

// ปรับยอดเงินโดยแอดมิน
app.post('/api/admin-adjust-balance', async (req, res) => {
  const { phone, amount, isDeduct } = req.body;
  let { data: member } = await supabase.from('members').select('*').eq('phone', phone).maybeSingle();
  
  if (!member) {
    const { data: newMem } = await supabase.from('members').insert([{ phone, password: '1234', role: 'member', status: 'member', balance: 0, comm_balance: 0 }]).select();
    member = newMem[0];
  }

  const newBalance = isDeduct ? Math.max(0, member.balance - amount) : member.balance + amount;
  await supabase.from('members').update({ balance: newBalance }).eq('phone', phone);
  await supabase.from('transactions').insert([{ type: isDeduct ? 'หักเงินโดยแอดมิน' : 'เพิ่มเงินโดยแอดมิน', phone, amount, sign: isDeduct ? '-' : '+', status: 'สำเร็จ' }]);
  
  res.json({ success: true });
});

// สร้างคำสั่งซื้อ
app.post('/api/orders', async (req, res) => {
  const { phone, address, affPhone, items, total, totalComm, slip, method } = req.body;
  
  const orderInsert = {
    phone, address, aff_phone: affPhone, total, total_comm: totalComm, slip,
    status: method === 'wallet' ? 'ชำระด้วยกระเป๋าเงินแล้ว (รอจัดส่ง)' : 'รอตรวจสอบสลิป'
  };
  const { data: orderData, error } = await supabase.from('orders').insert([orderInsert]).select();
  if (error) return res.status(400).json({ error: error.message });

  const orderId = orderData[0].id;
  const orderItems = items.map(i => ({ order_id: orderId, product_id: i.id, product_name: i.name, price: i.price }));
  await supabase.from('order_items').insert(orderItems);

  if (method === 'wallet') {
    const { data: member } = await supabase.from('members').select('*').eq('phone', phone).single();
    await supabase.from('members').update({ balance: member.balance - total }).eq('phone', phone);
    for (let i of items) {
      await supabase.from('products').update({ is_sold: true }).eq('id', i.id);
    }
    if (affPhone) {
      const { data: affMember } = await supabase.from('members').select('*').eq('phone', affPhone).maybeSingle();
      if (affMember) await supabase.from('members').update({ comm_balance: affMember.comm_balance + totalComm }).eq('phone', affPhone);
    }
    await supabase.from('transactions').insert([{ type: 'ซื้อสินค้าด้วยกระเป๋าเงิน', phone, amount: total, sign: '-', status: 'สำเร็จ' }]);
  }

  res.json({ success: true });
});

// อนุมัติคำสั่งซื้อ
app.post('/api/approve-order', async (req, res) => {
  const { orderId } = req.body;
  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (!order || order.status.includes('อนุมัติ')) return res.status(400).json({ error: 'Invalid order' });

  await supabase.from('orders').update({ status: 'อนุมัติจัดส่งแล้ว' }).eq('id', orderId);
  const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
  for (let i of items) {
    await supabase.from('products').update({ is_sold: true }).eq('id', i.product_id);
  }

  if (order.aff_phone) {
    const { data: affMember } = await supabase.from('members').select('*').eq('phone', order.aff_phone).maybeSingle();
    if (affMember) await supabase.from('members').update({ comm_balance: affMember.comm_balance + order.total_comm }).eq('phone', order.aff_phone);
  }

  await supabase.from('transactions').insert([{ type: 'รับชำระค่าสินค้า', phone: order.phone, amount: order.total, sign: '+', status: 'สำเร็จ' }]);
  res.json({ success: true });
});

// อนุมัติ Affiliate
app.post('/api/approve-affiliate', async (req, res) => {
  await supabase.from('members').update({ status: 'approved' }).eq('id', req.body.memberId);
  res.json({ success: true });
});

// ตั้งค่าระบบ
app.post('/api/settings', async (req, res) => {
  await supabase.from('settings').upsert({ id: 1, bank_info: req.body.bankInfo, admin_pin: req.body.adminPin });
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));