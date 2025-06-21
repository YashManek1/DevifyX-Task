# DevifyX Task — Custom Cron Job Runner (Backend API)

A robust, multi-tenant Node.js backend for scheduling, managing, and monitoring custom cron jobs via a RESTful API. Supports shell and HTTP jobs, dependencies, webhooks, job execution logging, and admin dashboards. No frontend required.

---

## 🚀 Features

- **Secure User Registration & Login** (JWT-based)
- **Multi-Tenancy**: Organizations/teams, isolated data per tenant
- **Custom Job Scheduling**: Create HTTP or shell jobs with cron syntax
- **Job Management**: List, update, enable/disable, delete jobs
- **Job Execution Engine**: Reliable, concurrent scheduler
- **Job History Logging**: Success/failure, output, timestamps
- **Retries & Error Handling**: Configurable retry logic
- **Webhook Support**: Notification on job completion/failure
- **Job Dependencies**: Schedule jobs based on other jobs' completion
- **Admin Dashboard API**: System health, statistics, user activity
- **API Security**: JWT, role-based admin, rate limiting
- **Swagger/OpenAPI Documentation**
- **Postman Collection** for easy testing

---

## 🛠️ Tech Stack

- **Node.js** (v14+)
- **Express.js**
- **MongoDB** (Mongoose)
- **node-cron** (job scheduler)
- **JWT** (authentication)
- **bcrypt** (password hashing)
- **Axios** (HTTP jobs and webhooks)

---

## ⚡ Getting Started

### 1. **Clone the repository**

```bash
git clone https://github.com/YashManek1/DevifyX-Task.git
cd DevifyX-Task
```

### 2. **Install dependencies**

```bash
npm install
```

### 3. **Configure Environment Variables**

Copy `.env.example` to `.env` and fill in your values:

```env
MONGO_URI=your-mongodb-uri-here
PORT=3000
JWT_SECRET=your-jwt-secret-here
```

### 4. **Run the server**

```bash
npm start
```
Server runs on `http://localhost:3000` by default.

---

## 🔐 **Authentication**

- All endpoints (except `/register`, `/login`) require a JWT token in the `Authorization` header:  
  `Authorization: Bearer <token>`

---

## 📚 **API Documentation**

- Full API reference available in [Swagger/OpenAPI docs](./swagger.yaml)  
- Or visit `/api-docs` (if Swagger-UI is served)

---

## 🧪 **Testing the API**

- Use the provided [Postman Collection](./DevifyX-Postman-Collection.json)  
- Import into Postman to try all endpoints easily

---

## 🏢 **Multi-Tenancy**

- Users belong to organizations; all jobs, histories, and data are isolated per org.

---

## 📝 **Job Dependencies**

- Jobs can depend on other jobs (by ID), and will only execute after all dependencies succeed.
- Cyclic dependencies are prevented.

---

## 🚦 **Admin Dashboard API**

Admin users can access special endpoints:

| Route                  | Description                       |
|------------------------|-----------------------------------|
| `/admin/health`        | System/DB health info             |
| `/admin/stats/jobs`    | Job statistics                    |
| `/admin/stats/users`   | User activity stats               |
| `/admin/jobs`          | List all jobs (all orgs)          |
| `/admin/users`         | List all users                    |

- **To become an admin**: Set your `role` to `admin` in your user document in MongoDB.

---

## 📈 **Job History & Monitoring**

- Every job run is logged with status, output, error, and retry count.
- History endpoints available for audit and debugging.

---

## 📦 **Project Structure**

```
.
├── controllers/
├── models/
├── middlewares/
├── config/
├── routes/
├── .env.example
├── README.md
├── swagger.yaml
└── ...
```

---

## 🤝 **Contributing**

PRs, issues, and suggestions welcome!

---

## 📄 **License**

MIT

---

## 👤 **Author**

- [Yash Manek](https://github.com/YashManek1)
- Assignment for [DevifyX Node.js Backend Challenge](https://forms.gle/LAvLWFmHRLXswwsx5)
