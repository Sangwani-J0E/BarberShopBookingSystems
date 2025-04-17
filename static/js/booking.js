document.addEventListener('DOMContentLoaded', function () {
    // Toggle Logic
    const calendarSection = document.getElementById('calendarSection');
    const quickSection = document.getElementById('quickSection');
    const showCalendarBtn = document.getElementById('showCalendarBtn');
    const showQuickBtn = document.getElementById('showQuickBtn');
    const slotsSidebar = document.getElementById('slotsSidebar');
    const closeSidebar = document.getElementById('closeSidebar');
    const selectedDate = document.getElementById('selectedDate');
    const slotsContainer = document.getElementById('slotsContainer');
    const bookingModal = new bootstrap.Modal(document.getElementById('bookingModal'));
    const quickPayBtn = document.getElementById('quickPayBtn');
    const modalPayBtn = document.getElementById('modalPayBtn');

    function showCalendar() {
        calendarSection.style.display = 'block';
        quickSection.style.display = 'none';
        showCalendarBtn.classList.add('active');
        showQuickBtn.classList.remove('active');
        initializeCalendar();
    }

    function showQuick() {
        calendarSection.style.display = 'none';
        quickSection.style.display = 'block';
        showCalendarBtn.classList.remove('active');
        showQuickBtn.classList.add('active');
    }

    showCalendarBtn.addEventListener('click', showCalendar);
    showQuickBtn.addEventListener('click', showQuick);

    // Normalize date for comparison
    function normalizeDate(dateStr) {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Calendar Logic
    let calendar = null;
    let holidays = [];

    function initializeCalendar() {
        if (calendar) {
            calendar.render();
            return;
        }
        const calendarEl = document.getElementById('calendar');
        if (!calendarEl) {
            console.error('Calendar element not found!');
            return;
        }

        const today = new Date();
        const maxDate = new Date();
        maxDate.setMonth(today.getMonth() + 5);

        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            validRange: { start: today, end: maxDate },
            events: '/api/bookings',
            dateClick: function (info) {
                const clickedDate = normalizeDate(info.dateStr);
                if (holidays.includes(clickedDate)) {
                    alert('This date is a holiday and cannot be booked.');
                    return;
                }
                selectedDate.textContent = clickedDate;
                slotsSidebar.classList.add('active');
                fetchSlots(clickedDate);
            },
            dayCellClassNames: function (arg) {
                const cellDate = normalizeDate(arg.date);
                return holidays.includes(cellDate) ? ['fc-day-holiday'] : [];
            },
            eventContent: function (arg) {
                if (arg.event.title.startsWith('Holiday:')) {
                    return { html: `<div class="holiday">${arg.event.title}</div>` };
                } else {
                    const time = arg.event.start.toTimeString().slice(0, 5);
                    return { html: `<div>${arg.event.title} at ${time}</div>` };
                }
            }
        });

        // Fetch holidays
        fetch('/api/bookings')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 401) {
                        window.location.href = '/login';
                    }
                    throw new Error(`Failed to fetch bookings: ${response.status}`);
                }
                return response.json();
            })
            .then(events => {
                if (!Array.isArray(events)) {
                    throw new Error('Invalid bookings data: not an array');
                }
                holidays = events
                    .filter(event => event.title && event.title.startsWith('Holiday:') && event.start)
                    .map(event => normalizeDate(event.start));
                calendar.render();
            })
            .catch(error => {
                console.error('Error fetching holidays:', error);
                calendar.render();
            });
    }

    initializeCalendar();

    // Close sidebar
    closeSidebar.addEventListener('click', function () {
        slotsSidebar.classList.remove('active');
    });

    // Fetch and display slots
    function fetchSlots(dateStr) {
        slotsContainer.innerHTML = '<p>Loading...</p>';
        fetch('/api/bookings')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 401) {
                        window.location.href = '/login';
                        return;
                    }
                    throw new Error(`Fetch failed with status ${response.status}`);
                }
                return response.json();
            })
            .then(bookings => {
                if (!Array.isArray(bookings)) {
                    throw new Error('Invalid bookings data: not an array');
                }
                const slots = generateSlots(dateStr, bookings);
                slotsContainer.innerHTML = '';
                if (slots.length === 0) {
                    slotsContainer.innerHTML = '<p>No available slots for this date.</p>';
                    return;
                }
                slots.forEach(slot => {
                    const div = document.createElement('div');
                    div.className = 'slot-item';
                    div.innerHTML = `
                        <span class="${slot.available ? 'text-success' : 'text-danger'}">
                            ${slot.time} - ${slot.available ? 'Available' : 'Booked'}
                        </span>
                    `;
                    if (slot.available) {
                        const bookBtn = document.createElement('button');
                        bookBtn.className = 'btn btn-sm btn-primary';
                        bookBtn.textContent = 'Book';
                        bookBtn.addEventListener('click', function () {
                            document.getElementById('booking_date').value = dateStr;
                            document.getElementById('booking_time').value = slot.time;
                            updateModalPrice();
                            bookingModal.show();
                        });
                        div.appendChild(bookBtn);
                    }
                    slotsContainer.appendChild(div);
                });
            })
            .catch(error => {
                console.error('Error fetching slots:', error);
                slotsContainer.innerHTML = `<p>Error loading slots: ${error.message}</p>`;
            });
    }

    // Generate slots
    function generateSlots(dateStr, bookings) {
        const slots = [];
        for (let h = 7; h < 20; h++) {
            if (h === 12) continue;
            const time = `${h.toString().padStart(2, '0')}:00`;
            const booked = bookings.some(b => {
                if (!b.start) return false;
                const startParts = b.start.split('T');
                if (startParts.length !== 2) return false;
                const bookingDate = startParts[0];
                const bookingTime = startParts[1].startsWith(time) && bookingDate === dateStr;
                return bookingTime;
            });
            slots.push({ time: time, available: !booked });
        }
        return slots;
    }

    // Quick Booking Logic
    const quickServiceSelect = document.getElementById('quick_service_type');
    const quickPriceDisplay = document.getElementById('quick_price_display').querySelector('span');
    const quickDate = document.getElementById('quick_booking_date');
    const quickTime = document.getElementById('quick_booking_time');
    const slotStatus = document.getElementById('slotStatus');

    function updateQuickPrice() {
        const service = quickServiceSelect.value;
        const price = SERVICE_PRICES[service] || 0;
        quickPriceDisplay.textContent = price.toLocaleString();
        checkQuickSlotAvailability();
    }

    function checkQuickSlotAvailability() {
        const date = quickDate.value;
        const time = quickTime.value;
        if (!date || !time) {
            slotStatus.textContent = 'Select a date and time to check availability';
            slotStatus.className = 'text-muted';
            quickPayBtn.disabled = true;
            return;
        }
        fetch('/api/bookings')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 401) {
                        window.location.href = '/login';
                        return;
                    }
                    throw new Error(`Fetch failed with status ${response.status}`);
                }
                return response.json();
            })
            .then(bookings => {
                if (!Array.isArray(bookings)) {
                    throw new Error('Invalid bookings data: not an array');
                }
                const isHoliday = bookings.some(b => b.title && b.title.startsWith('Holiday:') && normalizeDate(b.start) === date);
                if (isHoliday) {
                    slotStatus.textContent = 'This date is a holiday and cannot be booked.';
                    slotStatus.className = 'text-danger';
                    quickPayBtn.disabled = true;
                    return;
                }
                const isBooked = bookings.some(b => {
                    if (!b.start) return false;
                    const startParts = b.start.split('T');
                    if (startParts.length !== 2) return false;
                    const bookingDate = startParts[0];
                    const bookingTime = startParts[1].startsWith(time) && bookingDate === date;
                    return bookingTime;
                });
                if (isBooked) {
                    slotStatus.textContent = 'This slot is already booked.';
                    slotStatus.className = 'text-danger';
                    quickPayBtn.disabled = true;
                } else {
                    slotStatus.textContent = 'This slot is available!';
                    slotStatus.className = 'text-success';
                    quickPayBtn.disabled = false;
                }
            })
            .catch(error => {
                console.error('Error checking slot:', error);
                slotStatus.textContent = `Error checking availability: ${error.message}`;
                slotStatus.className = 'text-danger';
                quickPayBtn.disabled = true;
            });
    }

    quickServiceSelect.addEventListener('change', updateQuickPrice);
    quickDate.addEventListener('change', checkQuickSlotAvailability);
    quickTime.addEventListener('change', checkQuickSlotAvailability);

    // Modal Price Update
    const modalServiceSelect = document.getElementById('service_type');
    const modalPriceDisplay = document.getElementById('modal_price_display').querySelector('span');

    function updateModalPrice() {
        const service = modalServiceSelect.value;
        const price = SERVICE_PRICES[service] || 0;
        modalPriceDisplay.textContent = price.toLocaleString();
    }

    modalServiceSelect.addEventListener('change', updateModalPrice);

    // Handle Quick Booking Payment
    quickPayBtn.addEventListener('click', function () {
        const customerName = document.getElementById('quick_customer_name').value;
        const serviceType = quickServiceSelect.value;
        const bookingDate = quickDate.value;
        const bookingTime = quickTime.value;
        const price = SERVICE_PRICES[serviceType] || 0;

        if (!customerName || !serviceType || !bookingDate || !bookingTime) {
            alert('Please fill all fields.');
            return;
        }

        quickPayBtn.disabled = true;
        quickPayBtn.textContent = 'Initiating Payment...';
        const paymentStatus = document.getElementById('quick_payment_status');
        paymentStatus.textContent = 'Initiating payment...';

        fetch('/initiate_payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customer_name: customerName,
                service_type: serviceType,
                booking_date: bookingDate,
                booking_time: bookingTime,
                price: price
            })
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    paymentStatus.textContent = 'Redirecting to payment...';
                    window.location.href = data.payment_url;
                } else {
                    paymentStatus.textContent = `Payment error: ${data.message}`;
                    paymentStatus.className = 'payment-status text-danger';
                    quickPayBtn.disabled = false;
                    quickPayBtn.textContent = 'Pay Now';
                }
            })
            .catch(error => {
                console.error('Payment error:', error);
                paymentStatus.textContent = 'Payment error: Server issue';
                paymentStatus.className = 'payment-status text-danger';
                quickPayBtn.disabled = false;
                quickPayBtn.textContent = 'Pay Now';
            });
    });

    // Handle Calendar Booking Payment
    modalPayBtn.addEventListener('click', function () {
        const customerName = document.getElementById('customer_name').value;
        const serviceType = modalServiceSelect.value;
        const bookingDate = document.getElementById('booking_date').value;
        const bookingTime = document.getElementById('booking_time').value;
        const price = SERVICE_PRICES[serviceType] || 0;

        if (!customerName || !serviceType || !bookingDate || !bookingTime) {
            alert('Please fill all fields.');
            return;
        }

        modalPayBtn.disabled = true;
        modalPayBtn.textContent = 'Initiating Payment...';
        const paymentStatus = document.getElementById('modal_payment_status');
        paymentStatus.textContent = 'Initiating payment...';

        fetch('/initiate_payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customer_name: customerName,
                service_type: serviceType,
                booking_date: bookingDate,
                booking_time: bookingTime,
                price: price
            })
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    paymentStatus.textContent = 'Redirecting to payment...';
                    window.location.href = data.payment_url;
                } else {
                    paymentStatus.textContent = `Payment error: ${data.message}`;
                    paymentStatus.className = 'payment-status text-danger';
                    modalPayBtn.disabled = false;
                    modalPayBtn.textContent = 'Pay Now';
                }
            })
            .catch(error => {
                console.error('Payment error:', error);
                paymentStatus.textContent = 'Payment error: Server issue';
                paymentStatus.className = 'payment-status text-danger';
                modalPayBtn.disabled = false;
                modalPayBtn.textContent = 'Pay Now';
            });
    });

    // Initialize from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const selectedService = urlParams.get('service');
    const selectedPrice = urlParams.get('price');
    if (selectedService && SERVICE_PRICES[selectedService]) {
        showQuick();
        quickServiceSelect.value = selectedService;
        quickServiceSelect.disabled = true;
        modalServiceSelect.value = selectedService;
        modalServiceSelect.disabled = true;
        updateQuickPrice();
        updateModalPrice();
        if (selectedPrice) {
            quickPriceDisplay.textContent = parseInt(selectedPrice).toLocaleString();
            modalPriceDisplay.textContent = parseInt(selectedPrice).toLocaleString();
        }
    } else {
        quickServiceSelect.disabled = false;
        modalServiceSelect.disabled = false;
        updateQuickPrice();
        updateModalPrice();
    }

    // Trigger initial checks
    checkQuickSlotAvailability();
});