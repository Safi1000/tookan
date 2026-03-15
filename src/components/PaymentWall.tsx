import React from 'react';

interface PaymentWallProps {
    amount?: string;
}

const PaymentWall: React.FC<PaymentWallProps> = ({ amount }) => {
    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0f0f0f',
            color: '#fff',
            fontFamily: 'sans-serif',
            textAlign: 'center',
            padding: '2rem'
        }}>
            <div style={{ fontSize: '4rem' }}>🔒</div>
            <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>
                Service Suspended
            </h1>
            <p style={{ color: '#aaa', maxWidth: '480px', lineHeight: '1.7' }}>
                Access to this application has been suspended due to an outstanding payment.
                Please clear your dues to restore access.
            </p>
            <div style={{
                margin: '2rem 0',
                padding: '1.5rem 2.5rem',
                border: '1px solid #ff4444',
                borderRadius: '8px',
                backgroundColor: '#1a0000'
            }}>
                <p style={{ color: '#ff4444', fontSize: '1.1rem', margin: 0 }}>
                    Outstanding Amount: <strong>{amount || 'Contact developer'}</strong>
                </p>
            </div>
            <p style={{ color: '#888' }}>
                To restore access, contact:{' '}
                <a href="mailto:your@email.com" style={{ color: '#4a9eff' }}>
                    your@email.com
                </a>
            </p>
        </div>
    );
};

export default PaymentWall;