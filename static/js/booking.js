document.addEventListener('DOMContentLoaded', function() {
    // Service price map (synced with app.py)
    const servicePrices = {
        'VIP Cut': 5000,
        'Basic Cut': 3000,
        'Cut and Wash': 5000,
        'Kids Cut': 2000,
        'Facial Treatment': 10000,
        'Hair Conditioning': 6000
    };

    // Read query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const selectedService = urlParams.get('service');
    const selectedPrice = urlParams.get('price');

    // Toggle Logic
    const calendarSection = document.getElementById('calendarSection');
    const quickSection = document.getElementById('quickSection');
    const showCalendarBtn = document.getElementById('showCalendarBtn');
    const showQuickBtn = document.getElementById('showQuickBtn');

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

    // Quick Booking Form Price Update
    const quickServiceSelect = document.getElementById('quick_service_type');
    const quickPriceInput = document.getElementById('quick_price');
    const quickPriceDisplay = document.getElementById('quick_price_display').querySelector('span');

    function updateQuickPrice() {
        const service = quickServiceSelect.value;
        const price = servicePrices[service] || 0;
        quickPriceInput.value = price;
        quickPriceDisplay.textContent = price.toLocaleString();
    }

    quickServiceSelect.addEventListener('change', updateQuickPrice);

    // Calendar Booking Form Price Update
    const modalServiceSelect = document.getElementById('service_type');
    const modalPriceInput = document.getElementById('modal_price');
    const modalPriceDisplay = document.getElementById('modal_price_display').querySelector('span');

    function updateModalPrice() {
        const service = modalServiceSelect.value;
        const price = servicePrices[service] || 0;
        modalPriceInput.value = price;
        modalPriceDisplay.textContent = price.toLocaleString();
    }

    modalServiceSelect.addEventListener('change', updateModalPrice);

    // Pre-fill forms if coming from pricing
    if (selectedService && selectedPrice && servicePrices[selectedService]) {
        // Quick Booking Form
        quickServiceSelect.value = selectedService;
        quickServiceSelect.disabled = true;
        quickPriceInput.value = selectedPrice;
        quickPriceDisplay.textContent = parseInt(selectedPrice).toLocaleString();

        // Calendar Booking Form
        modalServiceSelect.value = selectedService;
        modalServiceSelect.disabled = true;
        modalPriceInput.value = selectedPrice;
        modalPriceDisplay.textContent = parseInt(selectedPrice).toLocaleString();

        // Default to Quick Booking
        showQuick();
    } else {
        // Ensure forms are editable for direct booking
        quickServiceSelect.disabled = false;
        modalServiceSelect.disabled = false;
        // Initialize price
        updateQuickPrice();
        updateModalPrice();
    }

    // Calendar Booking Logic
    let calendar = null;
    let holidays = [];

    function normalizeDate(dateStr) {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function initializeCalendar() {
        if (calendar) {
            calendar.render();
            return;
        }
        var calendarEl = document.getElementById('calendar');
        if (!calendarEl) {
            console.error('Calendar element not found!');
            return;
        }

        var today = new Date();
        var maxDate = new Date();
        maxDate.setMonth(today.getMonth() + 5);

        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            validRange: { start: today, end: maxDate },
            events: '/api/bookings',
            dateClick: function(info) {
                const clickedDate = normalizeDate(info.dateStr);
                if (holidays.includes(clickedDate)) {
                    alert('This date is a holiday and cannot be booked.');
                    return;
                }
                showSlots(clickedDate);
            },
            dayCellClassNames: function(arg) {
                const cellDate = normalizeDate(arg.date);
                return holidays.includes(cellDate) ? ['fc-day-holiday'] : [];
            },
            eventContent: function(arg) {
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

    var sidebar = document.getElementById('slotsSidebar');
    document.getElementById('closeSidebar').addEventListener('click', function() {
        sidebar.classList.remove('active');
    });

    function showSlots(dateStr) {
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
                var slots = generateSlots(dateStr, bookings);
                var container = document.getElementById('slotsContainer');
                container.innerHTML = '';
                document.getElementById('selectedDate').textContent = dateStr;

                if (slots.length === 0) {
                    container.innerHTML = '<p>No available slots for this date.</p>';
                    sidebar.classList.add('active');
                    return;
                }

                slots.forEach(slot => {
                    var div = document.createElement('div');
                    div.className = 'slot-item';
                    div.innerHTML = `
                        <span class="${slot.available ? 'text-success' : 'text-danger'}">
                            ${slot.time} - ${slot.available ? 'Available' : 'Booked'}
                        </span>
                    `;
                    if (slot.available) {
                        var bookBtn = document.createElement('button');
                        bookBtn.className = 'btn btn-sm btn-primary';
                        bookBtn.textContent = 'Book';
                        bookBtn.addEventListener('click', function() {
                            document.getElementById('booking_date').value = dateStr;
                            document.getElementById('booking_time').value = slot.time;
                            sidebar.classList.remove('active');
                            $('#bookingModal').modal('show');
                            updateModalPrice();
                        });
                        div.appendChild(bookBtn);
                    }
                    container.appendChild(div);
                });
                sidebar.classList.add('active');
            })
            .catch(error => {
                console.error('Error in showSlots:', error);
                document.getElementById('slotsContainer').innerHTML = `<p>Error loading slots: ${error.message}</p>`;
                sidebar.classList.add('active');
            });
    }

    function generateSlots(dateStr, bookings) {
        var slots = [];
        for (var h = 7; h < 20; h++) {
            if (h === 12) continue;
            var time = `${h.toString().padStart(2, '0')}:00`;
            // Normalize booking start times to handle missing seconds
            var booked = bookings.some(b => {
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

    // Quick Booking Form Logic
    const quickDate = document.getElementById('quick_booking_date');
    const quickTime = document.getElementById('quick_booking_time');
    const quickBookBtn = document.getElementById('quickBookBtn');
    const slotStatus = document.getElementById('slotStatus');

    function checkSlotAvailability() {
        const date = quickDate.value;
        const time = quickTime.value;
        if (date && time) {
            slotStatus.textContent = 'Checking availability...';
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
                        quickBookBtn.disabled = true;
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
                        quickBookBtn.disabled = true;
                    } else {
                        slotStatus.textContent = 'This slot is available!';
                        slotStatus.className = 'text-success';
                        quickBookBtn.disabled = false;
                    }
                })
                .catch(error => {
                    console.error('Error checking slot:', error);
                    slotStatus.textContent = `Error checking availability: ${error.message}`;
                    slotStatus.className = 'text-danger';
                    quickBookBtn.disabled = true;
                });
        } else {
            slotStatus.textContent = 'Select a date and time to check availability';
            slotStatus.className = 'text-muted';
            quickBookBtn.disabled = true;
        }
    }

    quickDate.addEventListener('change', checkSlotAvailability);
    quickTime.addEventListener('change', checkSlotAvailability);

    // Trigger initial availability and price check
    checkSlotAvailability();
    if (quickServiceSelect.value) updateQuickPrice();
});