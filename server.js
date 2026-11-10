const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(__dirname));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

let memorySettings = {
  bank_info: 'กสิกรไทย 123-4-56789-0 (กรีน พิกต์ ช๊อป)',
  admin_pin: '200822',
  banner1: 'https://i.ibb.co/6y404984/image-75e38c.jpg',
  banner2: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=1400',
  banner3: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=1400'
};

app.get('/api/dashboard', async (req, res) => {
  const { data: members } = await supabase.from('members').select('*').order('created_at', { ascending: false });
  const { data: products } = await supabase.from('products').select('*').order('created_at', { ascending: false });
  const { data: transactions } = await supabase.from('transactions').select('*').order('created_at', { ascending: false });
  const { data: financeRequests } = await supabase.from('finance_requests').select('*').order('created_at', { ascending: false });
  const { data: orders } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
  const { data: orderItems } = await supabase.from('order_items').select('*');
  const { data: settingsData, error: settingsErr } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();

  if (settingsData && !settingsErr) {
    memorySettings = {
      bank_info: settingsData.bank_info || memorySettings.bank_info,
      admin_pin: String(settingsData.admin_pin || memorySettings.admin_pin),
      banner1: settingsData.banner1 || memorySettings.banner1,
      banner2: settingsData.banner2 || memorySettings.banner2,
      banner3: settingsData.banner3 || memorySettings.banner3
    };
  }

  res.json({
    members: members || [],
    products: products || [],
    transactions: transactions || [],
    financeRequests: financeRequests || [],
    orders: orders || [],
    orderItems: orderItems || [],
    settings: memorySettings
  });
});

app.post('/api/admin-login', async (req, res) => {
  const { pin } = req.body;
  const { data: settingsData } = await supabase.from('settings').select('admin_pin').eq('id', 1).maybeSingle();
  const currentPin = settingsData?.admin_pin ? String(settingsData.admin_pin) : String(memorySettings.admin_pin);

  if (String(pin).trim() === currentPin.trim()) {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'รหัสผ่านแอดมินไม่ถูกต้อง' });
});

// อัปเดตการตั้งค่าระบบ รวมถึงแบนเนอร์
app.post('/api/settings', async (req, res) => {
  const bankInfo = (req.body.bankInfo || '').trim() || memorySettings.bank_info;
  const adminPin = String(req.body.adminPin || '').trim() || memorySettings.admin_pin;
  const banner1 = req.body.banner1 !== undefined ? req.body.banner1 : memorySettings.banner1;
  const banner2 = req.body.banner2 !== undefined ? req.body.banner2 : memorySettings.banner2;
  const banner3 = req.body.banner3 !== undefined ? req.body.banner3 : memorySettings.banner3;

  memorySettings = { bank_info: bankInfo, admin_pin: adminPin, banner1, banner2, banner3 };

  const { data, error } = await supabase
    .from('settings')
    .upsert({ id: 1, bank_info: bankInfo, admin_pin: adminPin, banner1, banner2, banner3 }, { onConflict: 'id' })
    .select();

  if (error) return res.json({ success: true, settings: memorySettings });
  res.json({ success: true, settings: data?.[0] || memorySettings });
});

app.post('/api/register', async (req, res) => {
  const { phone, name, password, bank, role } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'กรุณากรอกเบอร์โทรและรหัสผ่าน' });

  const { data: existingUser } = await supabase.from('members').select('*').eq('phone', phone).maybeSingle();
  if (existingUser) {
    return res.status(400).json({ error: 'เบอร์โทรศัพท์นี้ถูกใช้งานสมัครสมาชิกแล้ว ไม่สามารถสมัครซ้ำได้' });
  }

  const status = role === 'affiliate' ? 'pending' : 'member';
  const { data, error } = await supabase
    .from('members')
    .insert([{ phone, name: name || '', password, bank: bank || '', role: role || 'member', status, balance: 0, comm_balance: 0 }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, user: data[0] });
});

app.post('/api/admin-update-member-password', async (req, res) => {
  const { memberId, newPassword } = req.body;
  if (!memberId || !newPassword) return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });

  const { error } = await supabase.from('members').update({ password: newPassword }).eq('id', memberId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.delete('/api/admin-members/:id', async (req, res) => {
  const { error } = await supabase.from('members').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.post('/api/apply-affiliate', async (req, res) => {
  const { phone } = req.body;
  const { data, error } = await supabase.from('members').update({ role: 'affiliate', status: 'pending' }).eq('phone', phone).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, user: data?.[0] });
});

app.post('/api/products', async (req, res) => {
  const { name, size_detail, condition_grade, price, commission, image_url } = req.body;
  const { data, error } = await supabase.from('products').insert([{ name, size_detail, condition_grade, price, commission, image_url, is_sold: false }]).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data[0]);
});

app.delete('/api/products/:id', async (req, res) => {
  await supabase.from('products').delete().eq('id', req.params.id);
  res.json({ success: true });
});

app.post('/api/finance-request', async (req, res) => {
  const { reqType, phone, amount, slip, bank, source } = req.body;
  const { data: member } = await supabase.from('members').select('*').eq('phone', phone).maybeSingle();

  if (reqType === 'withdraw' && member) {
    if (source === 'commission' && Number(member.comm_balance) < Number(amount)) {
      return res.status(400).json({ error: 'ยอดค่าคอมมิชชันสะสมไม่เพียงพอ' });
    }
    if (source === 'wallet' && Number(member.balance) < Number(amount)) {
      return res.status(400).json({ error: 'เครดิตคงเหลือในกระเป๋าไม่เพียงพอ' });
    }
    if (source === 'commission') {
      await supabase.from('members').update({ comm_balance: Number(member.comm_balance) - Number(amount) }).eq('phone', phone);
    } else {
      await supabase.from('members').update({ balance: Number(member.balance) - Number(amount) }).eq('phone', phone);
    }
  }

  const { data, error } = await supabase
    .from('finance_requests')
    .insert([{ req_type: reqType, phone, amount, slip: slip || '', bank: bank || '', source: source || 'wallet', status: 'รอตรวจสอบ' }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data[0]);
});

app.post('/api/approve-finance', async (req, res) => {
  const { requestId } = req.body;
  const { data: reqData } = await supabase.from('finance_requests').select('*').eq('id', requestId).single();
  if (!reqData || reqData.status === 'สำเร็จ' || reqData.status.startsWith('ถูกปฏิเสธ')) return res.status(400).json({ error: 'Invalid request' });

  const { data: member } = await supabase.from('members').select('*').eq('phone', reqData.phone).maybeSingle();

  if (reqData.req_type === 'deposit' && member) {
    await supabase.from('members').update({ balance: Number(member.balance) + Number(reqData.amount) }).eq('phone', reqData.phone);
    await supabase.from('transactions').insert([{ type: 'ฝากเงินเข้ากระเป๋า', phone: reqData.phone, amount: reqData.amount, sign: '+', status: 'สำเร็จ' }]);
  } else if (reqData.req_type === 'withdraw') {
    await supabase.from('transactions').insert([{ type: 'ถอนเงินสำเร็จ', phone: reqData.phone, amount: reqData.amount, sign: '-', status: 'สำเร็จ' }]);
  }

  await supabase.from('finance_requests').update({ status: 'สำเร็จ' }).eq('id', requestId);
  res.json({ success: true });
});

app.post('/api/reject-finance', async (req, res) => {
  const { requestId, reason } = req.body;
  const { data: reqData } = await supabase.from('finance_requests').select('*').eq('id', requestId).single();
  if (!reqData || reqData.status === 'สำเร็จ' || reqData.status.startsWith('ถูกปฏิเสธ')) return res.status(400).json({ error: 'Invalid request' });

  if (reqData.req_type === 'withdraw') {
    const { data: member } = await supabase.from('members').select('*').eq('phone', reqData.phone).maybeSingle();
    if (member) {
      await supabase.from('members').update({ balance: Number(member.balance) + Number(reqData.amount) }).eq('phone', reqData.phone);
    }
  }

  const rejectStatusMsg = reason ? `ถูกปฏิเสธ: ${reason}` : 'ถูกปฏิเสธ';
  await supabase.from('finance_requests').update({ status: rejectStatusMsg }).eq('id', requestId);
  res.json({ success: true });
});

app.post('/api/admin-adjust-balance', async (req, res) => {
  const { phone, amount, isDeduct } = req.body;
  let { data: member } = await supabase.from('members').select('*').eq('phone', phone).maybeSingle();

  if (!member) {
    return res.status(400).json({ error: 'ไม่พบเบอร์สมาชิกนี้ในระบบ' });
  }

  const newBalance = isDeduct ? Math.max(0, Number(member.balance) - Number(amount)) : Number(member.balance) + Number(amount);
  await supabase.from('members').update({ balance: newBalance }).eq('phone', phone);
  await supabase.from('transactions').insert([{
    type: isDeduct ? 'หักเงินโดยแอดมิน' : 'เพิ่มเงินโดยแอดมิน',
    phone,
    amount,
    sign: isDeduct ? '-' : '+',
    status: 'สำเร็จ'
  }]);

  res.json({ success: true });
});

app.post('/api/orders', async (req, res) => {
  const { phone, address, affPhone, items, total, totalComm, method } = req.body;

  if (method === 'wallet') {
    const { data: member } = await supabase.from('members').select('*').eq('phone', phone).maybeSingle();
    if (!member || Number(member.balance) < Number(total)) {
      return res.status(400).json({ error: 'เครดิตคงเหลือไม่เพียงพอ กรุณากดปุ่ม + เพื่อเติมเครดิตก่อนครับ' });
    }
    await supabase.from('members').update({ balance: Number(member.balance) - Number(total) }).eq('phone', phone);
  }

  const orderInsert = {
    phone,
    address,
    aff_phone: affPhone || '',
    total,
    total_comm: totalComm,
    slip: '',
    status: method === 'wallet' ? 'รอแอดมินตรวจจัดส่ง (ตัดเครดิตแล้ว)' : 'รอตรวจสอบสลิป'
  };

  const { data: orderData, error } = await supabase.from('orders').insert([orderInsert]).select();
  if (error) return res.status(400).json({ error: error.message });

  const orderId = orderData[0].id;
  const orderItems = items.map(i => ({ order_id: orderId, product_id: i.id, product_name: i.name, price: i.price }));
  await supabase.from('order_items').insert(orderItems);

  if (method === 'wallet') {
    for (let i of items) {
      await supabase.from('products').update({ is_sold: true }).eq('id', i.id);
    }
    if (affPhone) {
      const { data: affMember } = await supabase.from('members').select('*').eq('phone', affPhone).maybeSingle();
      if (affMember) {
        await supabase.from('members').update({ comm_balance: Number(affMember.comm_balance) + Number(totalComm) }).eq('phone', affPhone);
      }
    }
    await supabase.from('transactions').insert([{ type: 'ซื้อเสื้อผ้าด้วยเครดิต', phone, amount: total, sign: '-', status: 'สำเร็จ' }]);
  }

  res.json({ success: true });
});

app.post('/api/approve-order', async (req, res) => {
  const { orderId } = req.body;
  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (!order || order.status === 'อนุมัติจัดส่งแล้ว') return res.status(400).json({ error: 'Invalid order' });

  await supabase.from('orders').update({ status: 'อนุมัติจัดส่งแล้ว' }).eq('id', orderId);
  const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
  if (items) {
    for (let i of items) {
      await supabase.from('products').update({ is_sold: true }).eq('id', i.product_id);
    }
  }

  if (order.aff_phone && !order.status.includes('ตัดเครดิตแล้ว')) {
    const { data: affMember } = await supabase.from('members').select('*').eq('phone', order.aff_phone).maybeSingle();
    if (affMember) {
      await supabase.from('members').update({ comm_balance: Number(affMember.comm_balance) + Number(order.total_comm) }).eq('phone', order.aff_phone);
    }
  }

  if (!order.status.includes('ตัดเครดิตแล้ว')) {
    await supabase.from('transactions').insert([{ type: 'รับชำระค่าสินค้า', phone: order.phone, amount: order.total, sign: '+', status: 'สำเร็จ' }]);
  }
  res.json({ success: true });
});

app.post('/api/approve-affiliate', async (req, res) => {
  await supabase.from('members').update({ status: 'approved', role: 'affiliate' }).eq('id', req.body.memberId);
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));