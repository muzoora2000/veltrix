const request = require('supertest');
const express = require('express');
const authRouter = require('../routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

describe('Auth Endpoints (Validation Tests)', () => {
  
  describe('POST /api/auth/register', () => {
    
    it('should reject registration requests missing a name', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'missingname@test.com',
          password: 'securePassword123',
          phone: '+256700000000'
        });
        
      expect(res.statusCode).toEqual(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Name is required');
    });

    it('should reject registration requests with short passwords', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'shortpass@test.com',
          password: '123',
          phone: '+256700000000'
        });
        
      expect(res.statusCode).toEqual(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toEqual('Password must be at least 6 characters');
    });

  });

  describe('POST /api/auth/login', () => {
    
    it('should reject login without credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.statusCode).toEqual(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Credentials required');
    });
    
  });
});
