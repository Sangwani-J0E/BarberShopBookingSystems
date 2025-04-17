from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
import bcrypt
from sqlalchemy import or_ as db_or
from datetime import datetime, timedelta, date
import re
from enum import Enum
from functools import wraps
from paychangu import PayChanguClient
from paychangu.models.payment import Payment
import uuid

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key'
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+pymysql://root:1234@localhost/barbershop_db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['REMEMBER_COOKIE_DURATION'] = timedelta(days=30)
app.config['PAYCHANGU_SECRET_KEY'] = 'sec-live-dwwqnF1d1I1utzZSIgWoZ8LOPPseDSxI'  # Replace with your PayChangu secret key

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.admin_login_view = 'admin_login'

paychangu_client = PayChanguClient(secret_key=app.config['PAYCHANGU_SECRET_KEY'])

class BookingStatus(Enum):
    ACTIVE = 'active'
    COMPLETED = 'completed'
    CANCELED = 'canceled'

class User(UserMixin, db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)

    def set_password(self, password):
        self.password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    def check_password(self, password):
        return bcrypt.checkpw(password.encode('utf-8'), self.password_hash.encode('utf-8'))

class Booking(db.Model):
    __tablename__ = 'bookings'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    customer_name = db.Column(db.String(100), nullable=False)
    service_type = db.Column(db.String(50), nullable=False)
    booking_date = db.Column(db.Date, nullable=False)
    booking_time = db.Column(db.Time, nullable=False)
    status = db.Column(db.String(20), nullable=False, default=BookingStatus.ACTIVE.value)
    payment_id = db.Column(db.String(100))
    payment_status = db.Column(db.String(20), default='pending')

class Holiday(db.Model):
    __tablename__ = 'holidays'
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, unique=True)
    description = db.Column(db.String(200))

class Notification(db.Model):
    __tablename__ = 'notifications'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    message = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    read = db.Column(db.Boolean, default=False)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            flash('Admins only. Please log in.', 'danger')
            return redirect(url_for('admin_login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

with app.app_context():
    db.create_all()

def is_strong_password(password):
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"
    if not re.search(r"[A-Z]", password):
        return False, "Password must contain at least one uppercase letter"
    if not re.search(r"[a-z]", password):
        return False, "Password must contain at least one lowercase letter"
    if not re.search(r"\d", password):
        return False, "Password must contain at least one number"
    if not re.search(r"[!@#$%^&*]", password):
        return False, "Password must contain at least one special character (!@#$%^&*)"
    return True, ""

SERVICE_PRICES = {
    'VIP Cut': 5000,
    'Basic Cut': 3000,
    'Cut and Wash': 5000,
    'Kids Cut': 2000,
    'Facial Treatment': 10000,
    'Hair Conditioning': 6000,
    'Gift Voucher': 5000
}

@app.route('/')
def index():
    notifications = Notification.query.filter_by(user_id=current_user.id, read=False).all() if current_user.is_authenticated else []
    return render_template('index.html', notifications=notifications)

@app.route('/about')
def about():
    notifications = Notification.query.filter_by(user_id=current_user.id, read=False).all() if current_user.is_authenticated else []
    return render_template('about.html', notifications=notifications)

@app.route('/pricing')
def pricing():
    services = SERVICE_PRICES
    notifications = Notification.query.filter_by(user_id=current_user.id, read=False).all() if current_user.is_authenticated else []
    return render_template('pricing.html', services=services, notifications=notifications)

@app.route('/contact')
def contact():
    notifications = Notification.query.filter_by(user_id=current_user.id, read=False).all() if current_user.is_authenticated else []
    return render_template('contact.html', notifications=notifications)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        identifier = request.form.get('identifier')
        password = request.form.get('password')
        remember = request.form.get('remember') == 'on'
        user = User.query.filter(db_or(User.username == identifier, User.email == identifier)).first()
        if user and user.check_password(password):
            if user.is_admin:
                flash('Admins should use the admin login page.', 'warning')
                return redirect(url_for('admin_login'))
            login_user(user, remember=remember)
            flash('Logged in successfully!', 'success')
            return redirect(url_for('index'))
        flash('Invalid username/email or password.', 'danger')
    return render_template('login.html')

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if current_user.is_authenticated:
        if current_user.is_admin:
            return redirect(url_for('admin_dashboard'))
        logout_user()
    if request.method == 'POST':
        identifier = request.form.get('identifier')
        password = request.form.get('password')
        remember = request.form.get('remember') == 'on'
        user = User.query.filter(db_or(User.username == identifier, User.email == identifier)).first()
        if user and user.check_password(password) and user.is_admin:
            login_user(user, remember=remember)
            flash('Admin logged in successfully!', 'success')
            next_page = request.args.get('next') or url_for('admin_dashboard')
            return redirect(next_page)
        flash('Invalid admin credentials.', 'danger')
    return render_template('admin_login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        is_valid, message = is_strong_password(password)
        if not is_valid:
            flash(message, 'danger')
            return render_template('register.html')
        if User.query.filter_by(username=username).first():
            flash('Username already exists.', 'danger')
        elif User.query.filter_by(email=email).first():
            flash('Email already registered.', 'danger')
        else:
            user = User(username=username, email=email)
            user.set_password(password)
            db.session.add(user)
            db.session.commit()
            flash('Registration successful! Please log in.', 'success')
            return redirect(url_for('login'))
    return render_template('register.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('Logged out successfully.', 'success')
    return redirect(url_for('index'))

@app.route('/initiate_payment', methods=['POST'])
@login_required
def initiate_payment():
    try:
        data = request.get_json()
        customer_name = data.get('customer_name')
        service_type = data.get('service_type')
        booking_date = data.get('booking_date')
        booking_time = data.get('booking_time')
        price = data.get('price')

        if not all([customer_name, service_type, booking_date, booking_time, price]):
            return jsonify({'success': False, 'message': 'Missing required fields'}), 400

        booking_date_obj = datetime.strptime(booking_date, '%Y-%m-%d').date()
        booking_time_obj = datetime.strptime(booking_time, '%H:%M').time()

        if Holiday.query.filter_by(date=booking_date_obj).first():
            return jsonify({'success': False, 'message': 'This date is a holiday'}), 400

        existing_booking = Booking.query.filter_by(
            booking_date=booking_date_obj,
            booking_time=booking_time_obj,
            status=BookingStatus.ACTIVE.value
        ).first()
        if existing_booking:
            return jsonify({'success': False, 'message': 'This slot is already booked'}), 400

        tx_ref = f"booking-{uuid.uuid4()}"
        payment = Payment(
            amount=int(price),
            currency="MWK",
            email=current_user.email,
            first_name=customer_name.split()[0],
            last_name=customer_name.split()[-1] if len(customer_name.split()) > 1 else "",
            callback_url="http://127.0.0.1:5000/payment_callback",
            return_url="http://127.0.0.1:5000/booking",
            tx_ref=tx_ref,
            customization={
                "title": f"TIMO FIRST CLASS - {service_type}",
                "description": f"Payment for {service_type} on {booking_date} at {booking_time}"
            }
        )
        response = paychangu_client.initiate_transaction(payment)
        if response.get('status') == 'success':
            booking = Booking(
                user_id=current_user.id,
                customer_name=customer_name,
                service_type=service_type,
                booking_date=booking_date_obj,
                booking_time=booking_time_obj,
                status=BookingStatus.ACTIVE.value,
                payment_id=tx_ref,
                payment_status='pending'
            )
            db.session.add(booking)
            db.session.commit()
            app.logger.info(f'Initiated payment: tx_ref={tx_ref}, booking_id={booking.id}')
            return jsonify({
                'success': True,
                'payment_url': response['data']['checkout_url'],
                'booking_id': booking.id
            })
        else:
            app.logger.error(f'Payment initiation failed: {response}')
            return jsonify({'success': False, 'message': 'Payment initiation failed'}), 400
    except Exception as e:
        app.logger.error(f'Initiate payment error: {str(e)}')
        return jsonify({'success': False, 'message': 'Server error'}), 500

@app.route('/payment_callback', methods=['POST'])
def payment_callback():
    try:
        data = request.get_json()
        tx_ref = data.get('tx_ref')
        booking = Booking.query.filter_by(payment_id=tx_ref).first()
        if not booking:
            app.logger.error(f'Callback: Booking not found for tx_ref={tx_ref}')
            return jsonify({'success': False}), 404

        response = paychangu_client.verify_transaction(tx_ref)
        if response.get('status') == 'success' and response['data']['status'] == 'success':
            booking.payment_status = 'completed'
            db.session.commit()
            app.logger.info(f'Payment verified: tx_ref={tx_ref}, booking_id={booking.id}')
            notification = Notification(
                user_id=booking.user_id,
                message=f"Your payment for {booking.service_type} on {booking.booking_date} at {booking.booking_time} was successful."
            )
            db.session.add(notification)
            db.session.commit()
        else:
            booking.payment_status = 'failed'
            booking.status = BookingStatus.CANCELED.value
            db.session.commit()
            app.logger.error(f'Payment verification failed: tx_ref={tx_ref}')
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f'Callback error: {str(e)}')
        return jsonify({'success': False}), 500

@app.route('/booking', methods=['GET'])
@login_required
def booking():
    try:
        user_bookings = Booking.query.filter_by(user_id=current_user.id)\
            .order_by(Booking.booking_date.desc(), Booking.booking_time.desc())\
            .limit(5).all() or []
        app.logger.info(f'Fetched {len(user_bookings)} bookings for user {current_user.id}')
    except Exception as e:
        app.logger.error(f'Error fetching user bookings: {str(e)}')
        user_bookings = []
        flash('Unable to load bookings. Please try again.', 'danger')

    services = list(SERVICE_PRICES.keys())
    notifications = Notification.query.filter_by(user_id=current_user.id, read=False).all()
    selected_service = request.args.get('service')
    selected_price = request.args.get('price')
    return render_template('booking.html', user_bookings=user_bookings, services=services, now=datetime.now(), notifications=notifications, selected_service=selected_service, selected_price=selected_price, service_prices=SERVICE_PRICES)

@app.route('/api/bookings')
@login_required
def get_bookings():
    try:
        bookings = Booking.query.filter_by(status=BookingStatus.ACTIVE.value).all()
        holidays = Holiday.query.all()
        app.logger.info(f'Fetched {len(bookings)} bookings and {len(holidays)} holidays for user {current_user.id}')
        events = []
        for b in bookings:
            if not b.booking_date or not b.booking_time:
                app.logger.warning(f'Invalid booking data: ID {b.id}, date {b.booking_date}, time {b.booking_time}')
                continue
            try:
                start_time = b.booking_time.strftime('%H:%M:00')
                events.append({
                    'id': b.id,
                    'title': f"{b.service_type} - Booked",
                    'start': f"{b.booking_date}T{start_time}",
                    'color': 'red'
                })
            except Exception as e:
                app.logger.error(f'Error formatting booking ID {b.id}: {str(e)}')
        for h in holidays:
            if not h.date:
                app.logger.warning(f'Invalid holiday data: ID {h.id}, date {h.date}')
                continue
            events.append({
                'title': f"Holiday: {h.description or 'Closed'}",
                'start': h.date.isoformat(),
                'allDay': True,
                'color': 'gray',
                'editable': False
            })
        return jsonify(events)
    except Exception as e:
        app.logger.error(f'Error in /api/bookings: {str(e)}')
        return jsonify({'error': 'Failed to fetch bookings'}), 500

@app.route('/history')
@login_required
def history():
    today = date.today()
    current_bookings = Booking.query.filter(
        Booking.user_id == current_user.id,
        Booking.status == BookingStatus.ACTIVE.value,
        Booking.booking_date >= today
    ).all()
    previous_bookings = Booking.query.filter(
        Booking.user_id == current_user.id,
        (Booking.status != BookingStatus.ACTIVE.value) | (Booking.booking_date < today)
    ).all()
    services = list(SERVICE_PRICES.keys())
    notifications = Notification.query.filter_by(user_id=current_user.id, read=False).all()
    return render_template('history.html', current_bookings=current_bookings, previous_bookings=previous_bookings, services=services, now=datetime.now(), notifications=notifications)

@app.route('/cancel_booking', methods=['POST'])
@login_required
def cancel_booking():
    booking_id = request.form.get('booking_id')
    booking = Booking.query.filter_by(id=booking_id, user_id=current_user.id).first()
    if not booking:
        return jsonify({'success': False, 'message': 'Booking not found.'})
    if booking.status != BookingStatus.ACTIVE.value:
        return jsonify({'success': False, 'message': 'Booking cannot be canceled.'})
    booking.status = BookingStatus.CANCELED.value
    db.session.commit()
    return jsonify({'success': True})

@app.route('/reschedule_booking', methods=['POST'])
@login_required
def reschedule_booking():
    booking_id = request.form.get('booking_id')
    service_type = request.form.get('service_type')
    booking_date = request.form.get('booking_date')
    booking_time = request.form.get('booking_time')

    booking = Booking.query.filter_by(id=booking_id, user_id=current_user.id).first()
    if not booking:
        flash('Booking not found.', 'danger')
        return redirect(url_for('history'))

    try:
        booking_date_obj = datetime.strptime(booking_date, '%Y-%m-%d').date()
        booking_time_obj = datetime.strptime(booking_time, '%H:%M').time()

        if Holiday.query.filter_by(date=booking_date_obj).first():
            flash('This date is a holiday and cannot be booked.', 'danger')
            return redirect(url_for('history'))

        existing_booking = Booking.query.filter(
            Booking.id != booking_id,
            Booking.booking_date == booking_date_obj,
            Booking.booking_time == booking_time_obj,
            Booking.status == BookingStatus.ACTIVE.value
        ).first()
        if existing_booking:
            flash('This slot is already booked.', 'danger')
            return redirect(url_for('history'))

        booking.service_type = service_type
        booking.booking_date = booking_date_obj
        booking.booking_time = booking_time_obj
        db.session.commit()
        flash('Booking rescheduled successfully!', 'success')
    except Exception as e:
        db.session.rollback()
        flash('Invalid data provided.', 'danger')

    return redirect(url_for('history'))

@app.route('/admin/dashboard')
@admin_required
def admin_dashboard():
    bookings = Booking.query.filter_by(status=BookingStatus.ACTIVE.value).all()
    holidays = Holiday.query.all()
    return render_template('admin_dashboard.html', bookings=bookings, holidays=holidays, now=datetime.now())

@app.route('/admin/add_holiday', methods=['GET', 'POST'])
@admin_required
def add_holiday():
    if request.method == 'POST':
        date_str = request.form.get('date')
        description = request.form.get('description')
        try:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
            if Holiday.query.filter_by(date=date_obj).first():
                flash('This date is already marked as a holiday.', 'danger')
            else:
                holiday = Holiday(date=date_obj, description=description)
                db.session.add(holiday)
                db.session.commit()
                flash('Holiday added successfully!', 'success')
            return redirect(url_for('admin_dashboard'))
        except Exception as e:
            flash('Invalid date provided.', 'danger')
    return render_template('add_holiday.html', now=datetime.now())

@app.route('/admin/delete_holiday/<int:holiday_id>', methods=['POST'])
@admin_required
def delete_holiday(holiday_id):
    holiday = Holiday.query.get_or_404(holiday_id)
    db.session.delete(holiday)
    db.session.commit()
    flash('Holiday removed successfully!', 'success')
    return redirect(url_for('admin_dashboard'))

@app.route('/admin/cancel_booking/<int:booking_id>', methods=['GET', 'POST'])
@admin_required
def admin_cancel_booking(booking_id):
    booking = Booking.query.get_or_404(booking_id)
    if request.method == 'POST':
        reason = request.form.get('reason')
        if not reason:
            flash('Please provide a reason for cancellation.', 'danger')
            return redirect(url_for('admin_cancel_booking', booking_id=booking_id))
        booking.status = BookingStatus.CANCELED.value
        notification = Notification(
            user_id=booking.user_id,
            message=f"Your booking for {booking.service_type} on {booking.booking_date} at {booking.booking_time} was canceled. Reason: {reason}"
        )
        db.session.add(notification)
        db.session.commit()
        flash('Booking canceled and user notified.', 'success')
        return redirect(url_for('admin_dashboard'))
    return render_template('admin_cancel_booking.html', booking=booking)

@app.route('/admin/reschedule_booking/<int:booking_id>', methods=['GET', 'POST'])
@admin_required
def admin_reschedule_booking(booking_id):
    booking = Booking.query.get_or_404(booking_id)
    services = list(SERVICE_PRICES.keys())
    if request.method == 'POST':
        service_type = request.form.get('service_type')
        booking_date = request.form.get('booking_date')
        booking_time = request.form.get('booking_time')
        reason = request.form.get('reason')
        if not reason:
            flash('Please provide a reason for rescheduling.', 'danger')
            return redirect(url_for('admin_reschedule_booking', booking_id=booking_id))
        try:
            booking_date_obj = datetime.strptime(booking_date, '%Y-%m-%d').date()
            booking_time_obj = datetime.strptime(booking_time, '%H:%M').time()

            if Holiday.query.filter_by(date=booking_date_obj).first():
                flash('This date is a holiday and cannot be booked.', 'danger')
                return redirect(url_for('admin_reschedule_booking', booking_id=booking_id))

            existing_booking = Booking.query.filter(
                Booking.id != booking_id,
                Booking.booking_date == booking_date_obj,
                Booking.booking_time == booking_time_obj,
                Booking.status == BookingStatus.ACTIVE.value
            ).first()
            if existing_booking:
                flash('This slot is already booked.', 'danger')
                return redirect(url_for('admin_reschedule_booking', booking_id=booking_id))

            booking.service_type = service_type
            booking.booking_date = booking_date_obj
            booking.booking_time = booking_time_obj
            notification = Notification(
                user_id=booking.user_id,
                message=f"Your booking for {booking.service_type} was rescheduled to {booking_date} at {booking_time}. Reason: {reason}"
            )
            db.session.add(notification)
            db.session.commit()
            flash('Booking rescheduled and user notified.', 'success')
            return redirect(url_for('admin_dashboard'))
        except Exception as e:
            flash('Invalid data provided.', 'danger')
    return render_template('admin_reschedule_booking.html', booking=booking, services=services, now=datetime.now())

@app.route('/notifications')
@login_required
def notifications():
    notifications = Notification.query.filter_by(user_id=current_user.id).order_by(Notification.created_at.desc()).all()
    for notification in notifications:
        notification.read = True
    db.session.commit()
    return render_template('notifications.html', notifications=notifications)

@app.route('/shop-display')
def shop_display():
    today = date.today()
    bookings = Booking.query.filter(
        Booking.booking_date == today,
        Booking.status == BookingStatus.ACTIVE.value
    ).order_by(Booking.booking_time).all()
    formatted_bookings = [
        {
            'id': b.id,
            'customer_name': b.customer_name,
            'service_type': b.service_type,
            'booking_time': b.booking_time.strftime('%H:%M'),
            'time_obj': datetime.combine(today, b.booking_time)
        } for b in bookings
    ]
    return render_template('shop_display.html', bookings=formatted_bookings, now=datetime.now())

if __name__ == '__main__':
    app.run(debug=True)