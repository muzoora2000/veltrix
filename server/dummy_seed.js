const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const dbUrl = process.env.DATABASE_URL;

(async () => {
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });
  
  await client.connect();
  console.log('Connected to Neon!');
  
  // Wipe
  await client.query(`
    TRUNCATE citizen_report_tracking, report_media, incident_analysis, task_assignments, response_tickets,
             citizen_reports, health_incidents, community_reports, alerts, water_quality_tests, flood_alerts,
             drought_index, climate_readings, maintenance_requests, sensor_readings, sensors, water_points, users
    RESTART IDENTITY CASCADE;
  `);

  console.log('Tables truncated!');

  const hash = bcrypt.hashSync('walter123', 10);
  
  await client.query(`INSERT INTO users (name, email, password_hash, role, district, organization, active) VALUES 
    ('Walter Olum', 'walter.olum@hydrosense.ug', $1, 'national_admin', 'National', 'MoWE', 1),
    ('Sarah Kibirige', 'sarah.k@health.ug', $1, 'health_officer', 'Kampala', 'MoH', 1),
    ('John Okello', 'john.tech@water.ug', $1, 'technician', 'Gulu', 'NWSC', 1),
    ('Peter Kato', 'kato.climate@env.ug', $1, 'climate_scientist', 'National', 'UNMA', 1)`, [hash]);

  await client.query(`INSERT INTO water_points (name, district, type, lat, lng, status, installed_date, pump_type, yield_lph, solar_powered) VALUES
    ('Bwaise Community Tap', 'Kampala', 'borehole', 0.35, 32.56, 'functional', '2018-05-15', 'India Mark II', 1200, 0),
    ('Gulu Main Borehole', 'Gulu', 'borehole', 2.77, 32.30, 'needs_repair', '2018-06-20', 'India Mark II', 400, 0),
    ('Kasubi Spring 2', 'Kampala', 'borehole', 0.32, 32.55, 'non_functional', '2018-11-10', 'India Mark II', 0, 0),
    ('Kasese Solar Pump', 'Kasese', 'borehole', 0.18, 30.07, 'functional', '2018-02-05', 'India Mark II', 2500, 1)`);

  await client.query(`INSERT INTO sensors (water_point_id, sensor_type, sensor_name, serial_number) VALUES (1, 'water_quality', 'Main Sensor', 'SN-WQ-100')`);
  
  for(let i=0; i<20; i++) {
    await client.query(`INSERT INTO sensor_readings (sensor_id, water_point_id, value, unit) VALUES (1, 1, $1, 'pH')`, 
      [7.1 + Math.random()*0.4]);
  }

  await client.query(`INSERT INTO health_incidents (district, village, disease_type, cases, water_source_linked, water_point_id) VALUES 
    ('Kampala', 'Bwaise', 'Cholera', 12, 1, 3),
    ('Gulu', 'Layibi', 'Typhoid', 4, 0, null)`);

  await client.query(`INSERT INTO climate_readings (district, rainfall_mm, temperature_max, temperature_min, humidity_pct, wind_speed_kmh) VALUES ('National', 120.5, 29.4, 18.2, 75, 12)`);
  await client.query(`INSERT INTO drought_index (district, spi_value, severity) VALUES 
    ('Kasese', -1.8, 'severe_drought'),
    ('Gulu', -1.2, 'moderate_drought')`);

  await client.query(`INSERT INTO citizen_reports (reporter_name, incident_type, description, district, village, lat, lng, status) VALUES 
    ('Concerned Citizen', 'broken_pipe', 'Massive pipe burst flooding the road', 'Kampala', 'Bwaise Zone 3', 0.35, 32.56, 'investigating')`);
  
  await client.query(`INSERT INTO alerts (alert_type, severity, district, title, message) VALUES 
    ('drought', 'high', 'Kasese', 'Drought Alert', 'SPI indicates severe drought conditions for Kasese'),
    ('health', 'critical', 'Kampala', 'Health Alert', 'Cholera outbreak confirmed near Kasubi Spring 2')`);

  console.log('✅ Dummy data populated perfectly!');
  await client.end();
})();
